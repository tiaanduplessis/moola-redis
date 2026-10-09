'use strict'

// Own the Redis boundary so these tests never open a socket or need a server.
jest.mock('redis', () => ({ createClient: jest.fn() }))

const redis = require('redis')
const cache = require('./')

const request = (url = '/', headers = {}) => {
  // Node normalizes incoming header names; Express's header getter is also
  // case-insensitive. Model that boundary without loading an HTTP framework.
  const canonicalHeaders = {}
  Object.keys(headers).forEach(name => { canonicalHeaders[name.toLowerCase()] = headers[name] })
  return { url, header: name => canonicalHeaders[name.toLowerCase()] }
}

let client

beforeEach(() => {
  client = { get: jest.fn(), setex: jest.fn() }
  redis.createClient.mockReset()
  redis.createClient.mockReturnValue(client)
})

const dispatch = (middleware, req = request()) => {
  const res = { send: jest.fn() }
  const next = jest.fn()
  middleware(req, res, next)
  return { res, next }
}

const reply = (error, value) => client.get.mock.calls[0][1](error, value)

test('exports a middleware factory', () => {
  expect(typeof cache).toBe('function')
})

test('requires a numeric duration before creating a client', () => {
  ;[undefined, {}, { duration: '30' }].forEach(options => {
    expect(() => cache(options)).toThrow('duration should be a number')
  })
  expect(redis.createClient).not.toHaveBeenCalled()
})

test('passes redisOpts through and creates one client per middleware', () => {
  const redisOpts = { host: 'synthetic.invalid', port: 6380, db: 2 }
  const middleware = cache({ duration: 30, redisOpts })
  dispatch(middleware)
  dispatch(middleware, request('/again'))
  expect(typeof middleware).toBe('function')
  expect(redis.createClient).toHaveBeenCalledTimes(1)
  expect(redis.createClient).toHaveBeenCalledWith(redisOpts)
  expect(client.get).toHaveBeenCalledTimes(2)
})

test('passes the documented redis options to the client unchanged', () => {
  const options = Object.freeze({ host: 'synthetic.invalid', port: 6381, db: 3 })
  cache({ duration: 30, redis: options })
  expect(redis.createClient).toHaveBeenCalledTimes(1)
  expect(redis.createClient.mock.calls[0][0]).toBe(options)
})

test('keeps explicit redisOpts ahead of the documented redis option', () => {
  const options = { host: 'documented.invalid', port: 6381 }
  const redisOpts = { host: 'legacy.invalid', port: 6382 }
  cache({ duration: 30, redis: options, redisOpts })
  expect(redis.createClient.mock.calls[0][0]).toBe(redisOpts)
})

test('uses the documented option when redisOpts is explicitly undefined', () => {
  const options = { host: 'synthetic.invalid', port: 6381 }
  cache({ duration: 30, redis: options, redisOpts: undefined })
  expect(redis.createClient.mock.calls[0][0]).toBe(options)
})

test('preserves explicit null, falsy, and empty legacy options', () => {
  ;[null, false, 0, '', {}].forEach(redisOpts => {
    redis.createClient.mockClear()
    const options = { duration: 30, redisOpts }
    Object.defineProperty(options, 'redis', {
      get () { throw new Error('The fallback must not be read') }
    })
    cache(options)
    expect(redis.createClient).toHaveBeenCalledTimes(1)
    expect(redis.createClient.mock.calls[0][0]).toBe(redisOpts)
  })
})

test('reads the documented fallback once when it is needed', () => {
  const config = { host: 'synthetic.invalid', port: 6381 }
  let reads = 0
  const options = { duration: 30 }
  Object.defineProperty(options, 'redis', {
    get () {
      reads++
      return config
    }
  })
  cache(options)
  expect(reads).toBe(1)
  expect(redis.createClient.mock.calls[0][0]).toBe(config)
})

test('documented options preserve cache writes, expiry, and callbacks', () => {
  const options = { host: 'synthetic.invalid', port: 6381 }
  const { res, next } = dispatch(cache({ duration: 45, redis: options }), request('/alias'))
  expect(redis.createClient.mock.calls[0][0]).toBe(options)
  reply(null, null)
  const body = { value: 'fixture' }
  res.sendCached(body)
  expect(client.setex).toHaveBeenCalledWith('["/alias",null,null,null]', 45, JSON.stringify(body))
  expect(res.send).toHaveBeenCalledWith(body)
  expect(next).toHaveBeenCalledTimes(1)
})

test('passes undefined client options when redisOpts is omitted', () => {
  cache({ duration: 30 })
  expect(redis.createClient).toHaveBeenCalledWith(undefined)
})

test('waits for the Redis callback before continuing', () => {
  const { res, next } = dispatch(cache({ duration: 30 }))
  expect(next).not.toHaveBeenCalled()
  expect(res.send).not.toHaveBeenCalled()
  expect(res.sendCached).toBeUndefined()
  expect(client.setex).not.toHaveBeenCalled()
})

test('uses an unambiguous URL and header cache key', () => {
  const req = request('/route?x=1', {
    accepts: 'application/json',
    'accept-encoding': 'gzip'
  })
  req.originalUrl = '/mount/route?x=1'
  dispatch(cache({ duration: 30 }), req)
  expect(client.get.mock.calls[0][0]).toBe('["/route?x=1",null,"application/json","gzip"]')
})

test('falls back to originalUrl when url is empty', () => {
  const req = request('')
  req.originalUrl = '/original'
  dispatch(cache({ duration: 30 }), req)
  expect(client.get.mock.calls[0][0]).toBe('["/original",null,null,null]')
})

test('forwards lookup errors without sending or caching', () => {
  const error = new Error('synthetic lookup failure')
  const { res, next } = dispatch(cache({ duration: 30 }))
  reply(error)
  expect(next).toHaveBeenCalledTimes(1)
  expect(next).toHaveBeenCalledWith(error)
  expect(res.send).not.toHaveBeenCalled()
  expect(res.sendCached).toBeUndefined()
  expect(client.setex).not.toHaveBeenCalled()
})

test('a miss continues once without sending or writing yet', () => {
  const { res, next } = dispatch(cache({ duration: 30 }))
  reply(null, null)
  expect(next).toHaveBeenCalledTimes(1)
  expect(next).toHaveBeenCalledWith()
  expect(typeof res.sendCached).toBe('function')
  expect(res.send).not.toHaveBeenCalled()
  expect(client.setex).not.toHaveBeenCalled()
})

test('sendCached serializes a miss with its key and expiry and sends the body', () => {
  const { res, next } = dispatch(cache({ duration: 45 }), request('/data'))
  reply(null, null)
  const body = { answer: 42, nested: ['value', false] }
  res.sendCached(body)
  expect(client.setex).toHaveBeenCalledTimes(1)
  expect(client.setex).toHaveBeenCalledWith(
    '["/data",null,null,null]',
    45,
    JSON.stringify(body)
  )
  expect(res.send).toHaveBeenCalledTimes(1)
  expect(res.send).toHaveBeenCalledWith(body)
  expect(next).toHaveBeenCalledTimes(1)
})

test('plain send on a miss keeps its existing non-caching behavior', () => {
  const { res } = dispatch(cache({ duration: 30 }))
  const originalSend = res.send
  reply(null, null)
  expect(res.send).toBe(originalSend)
  res.send('uncached')
  expect(client.setex).not.toHaveBeenCalled()
})

test('a hit parses JSON and sends it without continuing or rewriting it', () => {
  const { res, next } = dispatch(cache({ duration: 30 }))
  const originalSend = res.send
  reply(null, '{"answer":42}')
  expect(res.sendCached).toBe(originalSend)
  expect(res.send).toHaveBeenCalledTimes(1)
  expect(res.send).toHaveBeenCalledWith({ answer: 42 })
  expect(next).not.toHaveBeenCalled()
  expect(client.setex).not.toHaveBeenCalled()
})

test('cached JSON primitives are passed to send unchanged', () => {
  ;['false', '0', 'null', '"text"'].forEach(value => {
    client.get.mockClear()
    const { res, next } = dispatch(cache({ duration: 30 }))
    reply(null, value)
    expect(res.send).toHaveBeenCalledWith(JSON.parse(value))
    expect(next).not.toHaveBeenCalled()
  })
  expect(client.setex).not.toHaveBeenCalled()
})

test('invalid cached JSON forwards the parse error without sending', () => {
  const { res, next } = dispatch(cache({ duration: 30 }))
  reply(null, '{invalid')
  expect(next).toHaveBeenCalledTimes(1)
  expect(next.mock.calls[0][0]).toBeInstanceOf(Error)
  expect(res.send).not.toHaveBeenCalled()
  expect(client.setex).not.toHaveBeenCalled()
})

test('an empty Redis value follows the existing cache-miss path', () => {
  const { res, next } = dispatch(cache({ duration: 30 }))
  reply(null, '')
  res.sendCached('replacement')
  expect(client.setex).toHaveBeenCalledWith(
    '["/",null,null,null]',
    30,
    '"replacement"'
  )
  expect(next).toHaveBeenCalledTimes(1)
})

test('pending requests retain their own cache keys and responses', () => {
  const middleware = cache({ duration: 30 })
  const first = dispatch(middleware, request('/first'))
  const second = dispatch(middleware, request('/second'))
  client.get.mock.calls[1][1](null, null)
  client.get.mock.calls[0][1](null, null)
  second.res.sendCached({ id: 2 })
  first.res.sendCached({ id: 1 })
  expect(client.setex.mock.calls).toEqual([
    ['["/second",null,null,null]', 30, '{"id":2}'],
    ['["/first",null,null,null]', 30, '{"id":1}']
  ])
  expect(first.res.send).toHaveBeenCalledWith({ id: 1 })
  expect(second.res.send).toHaveBeenCalledWith({ id: 2 })
  expect(first.next).toHaveBeenCalledTimes(1)
  expect(second.next).toHaveBeenCalledTimes(1)
})

const storedValues = (entries = []) => {
  const values = new Map(entries)
  client.get = jest.fn((key, callback) => callback(null, values.has(key) ? values.get(key) : null))
  client.setex = jest.fn((key, duration, value) => { values.set(key, value) })
  return values
}

test('keeps standard Accept representations in separate cache entries', () => {
  const values = storedValues()
  const middleware = cache({ duration: 45 })
  const first = dispatch(middleware, request('/report', { accept: 'application/json' }))
  expect(first.res.send).not.toHaveBeenCalled()
  first.res.sendCached({ format: 'json' })

  const second = dispatch(middleware, request('/report', { accept: 'text/html' }))
  expect(second.res.send).not.toHaveBeenCalled()
  second.res.sendCached({ format: 'html' })

  const jsonHit = dispatch(middleware, request('/report', { accept: 'application/json' }))
  const htmlHit = dispatch(middleware, request('/report', { accept: 'text/html' }))
  expect(jsonHit.res.send).toHaveBeenCalledWith({ format: 'json' })
  expect(htmlHit.res.send).toHaveBeenCalledWith({ format: 'html' })
  expect(values.size).toBe(2)
  expect(client.setex).toHaveBeenCalledTimes(2)
  expect(client.setex.mock.calls[0][1]).toBe(45)
  expect(client.setex.mock.calls[1][1]).toBe(45)
  ;[first, second].forEach(result => expect(result.next).toHaveBeenCalledTimes(1))
  ;[jsonHit, htmlHit].forEach(result => expect(result.next).not.toHaveBeenCalled())
})

test('separates dotted URL and legacy header components', () => {
  const values = storedValues()
  const middleware = cache({ duration: 30 })
  const firstRequest = request('/report.json', { accepts: 'application/json', 'accept-encoding': 'gzip' })
  const secondRequest = request('/report', { accepts: 'json.application/json', 'accept-encoding': 'gzip' })
  const first = dispatch(middleware, firstRequest)
  first.res.sendCached({ route: 'first' })
  const second = dispatch(middleware, secondRequest)
  expect(second.res.send).not.toHaveBeenCalled()
  second.res.sendCached({ route: 'second' })
  expect(dispatch(middleware, firstRequest).res.send).toHaveBeenCalledWith({ route: 'first' })
  expect(dispatch(middleware, secondRequest).res.send).toHaveBeenCalledWith({ route: 'second' })
  expect(values.size).toBe(2)
})

test('retains legacy Accepts and encoding as independent key components', () => {
  const middleware = cache({ duration: 30 })
  ;[
    { accept: 'application/json', accepts: 'legacy-a', 'accept-encoding': 'gzip' },
    { accept: 'application/json', accepts: 'legacy-b', 'accept-encoding': 'gzip' },
    { accept: 'application/json', accepts: 'legacy-a', 'accept-encoding': 'br' }
  ].forEach(headers => dispatch(middleware, request('/legacy', headers)))
  const keys = client.get.mock.calls.map(call => call[0])
  expect(new Set(keys).size).toBe(3)
})

test('distinguishes absent, empty, and literal undefined header values', () => {
  const middleware = cache({ duration: 30 })
  ;['accept', 'accepts', 'accept-encoding'].forEach(name => {
    client.get.mockClear()
    ;[undefined, '', 'undefined'].forEach(value => {
      const headers = {}
      if (value !== undefined) headers[name] = value
      dispatch(middleware, request('/empty', headers))
    })
    const keys = client.get.mock.calls.map(call => call[0])
    expect(new Set(keys).size).toBe(3)
  })
})

test('uses canonical header names consistently across casing', () => {
  const middleware = cache({ duration: 30 })
  dispatch(middleware, request('/case', {
    Accept: 'application/json', Accepts: 'legacy', 'Accept-Encoding': 'gzip'
  }))
  dispatch(middleware, request('/case', {
    accept: 'application/json', accepts: 'legacy', 'accept-encoding': 'gzip'
  }))
  expect(client.get.mock.calls[0][0]).toBe(client.get.mock.calls[1][0])
  expect(client.get.mock.calls[0][0]).toBe('["/case","application/json","legacy","gzip"]')
})

test('preserves quoted and escaped header values in both reads and writes', () => {
  const middleware = cache({ duration: 30 })
  const headers = {
    accept: 'application/json; profile="a.b"',
    accepts: 'legacy\\value',
    'accept-encoding': 'gzip'
  }
  const result = dispatch(middleware, request('/price?item=a.b', headers))
  const key = client.get.mock.calls[0][0]
  expect(JSON.parse(key)).toEqual(['/price?item=a.b', headers.accept, headers.accepts, 'gzip'])
  reply(null, null)
  result.res.sendCached({ price: 3 })
  expect(client.setex.mock.calls[0][0]).toBe(key)
})

test('leaves earlier-format entries untouched while filling the new cache', () => {
  const oldKey = '/migration.undefined.undefined'
  const oldValue = '{"generation":"old"}'
  const values = storedValues([[oldKey, oldValue]])
  const result = dispatch(cache({ duration: 30 }), request('/migration'))
  expect(result.res.send).not.toHaveBeenCalled()
  expect(client.get.mock.calls[0][0]).toBe('["/migration",null,null,null]')
  result.res.sendCached({ generation: 'new' })
  expect(values.get(oldKey)).toBe(oldValue)
  expect(values.size).toBe(2)
  expect(client.setex).toHaveBeenCalledWith('["/migration",null,null,null]', 30, '{"generation":"new"}')
})

const { IncomingMessage, ServerResponse } = require('http')
const { Duplex } = require('stream')

const nativeResponse = () => {
  const chunks = []
  const socket = new Duplex({
    read () {},
    write (chunk, encoding, callback) {
      chunks.push(Buffer.from(chunk))
      callback()
    }
  })
  const req = new IncomingMessage(socket)
  req.method = 'GET'
  req.url = '/native'
  req.httpVersionMajor = 1
  req.httpVersionMinor = 1
  req.headers = {}
  req.header = name => req.headers[name.toLowerCase()]
  const res = new ServerResponse(req)
  res.assignSocket(socket)
  res.send = body => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  }
  return {
    req,
    res,
    wire: () => Buffer.concat(chunks).toString(),
    close: () => {
      if (typeof socket.destroy === 'function') socket.destroy()
      else socket.end()
    }
  }
}

test('a native cached response does not invoke a route or write twice', () => {
  const fixture = nativeResponse()
  let routeCalls = 0
  const errors = []
  const next = jest.fn(error => {
    if (error) {
      errors.push(error)
      return
    }
    routeCalls++
    fixture.res.send({ source: 'route' })
  })
  try {
    cache({ duration: 30 })(fixture.req, fixture.res, next)
    expect(fixture.res.finished).toBe(false)
    reply(null, '{"source":"cache"}')
    expect(routeCalls).toBe(0)
    expect(errors).toEqual([])
    expect(next).not.toHaveBeenCalled()
    expect(fixture.res.headersSent).toBe(true)
    expect(fixture.res.finished).toBe(true)
    expect(fixture.wire()).toMatch(/\{"source":"cache"\}/)
    expect(client.setex).not.toHaveBeenCalled()
  } finally {
    fixture.close()
  }
})

test('a native miss still invokes its route once and stores the response', () => {
  const fixture = nativeResponse()
  const next = jest.fn(error => {
    if (error) throw error
    fixture.res.sendCached({ source: 'route' })
  })
  try {
    cache({ duration: 45 })(fixture.req, fixture.res, next)
    expect(next).not.toHaveBeenCalled()
    reply(null, null)
    expect(next).toHaveBeenCalledTimes(1)
    expect(next).toHaveBeenCalledWith()
    expect(fixture.res.finished).toBe(true)
    expect(fixture.wire()).toMatch(/\{"source":"route"\}/)
    expect(client.setex).toHaveBeenCalledWith('["/native",null,null,null]', 45, '{"source":"route"}')
  } finally {
    fixture.close()
  }
})

test('native response lookup and parse failures still continue once without sending', () => {
  ;['lookup', 'parse'].forEach(kind => {
    const fixture = nativeResponse()
    const next = jest.fn()
    const error = new Error('fixture lookup failure')
    try {
      cache({ duration: 30 })(fixture.req, fixture.res, next)
      if (kind === 'lookup') reply(error)
      else reply(null, '{invalid')
      expect(next).toHaveBeenCalledTimes(1)
      if (kind === 'lookup') expect(next).toHaveBeenCalledWith(error)
      else expect(next.mock.calls[0][0]).toBeInstanceOf(Error)
      expect(fixture.res.headersSent).toBe(false)
      expect(fixture.res.finished).toBe(false)
      expect(client.setex).not.toHaveBeenCalled()
    } finally {
      fixture.close()
    }
    client.get.mockClear()
  })
})

test('a native send failure on a cache hit still reaches the error continuation once', () => {
  const fixture = nativeResponse()
  const next = jest.fn()
  try {
    fixture.res.writeHead(200, { 'X-Fixture': 'already sent' })
    cache({ duration: 30 })(fixture.req, fixture.res, next)
    reply(null, '{"source":"cache"}')
    expect(next).toHaveBeenCalledTimes(1)
    expect(next.mock.calls[0][0].message).toMatch(/headers.*sent/i)
    expect(fixture.res.finished).toBe(false)
    expect(client.setex).not.toHaveBeenCalled()
  } finally {
    fixture.close()
  }
})
