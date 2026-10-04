'use strict'

// Own the Redis boundary so these tests never open a socket or need a server.
jest.mock('redis', () => ({ createClient: jest.fn() }))

const redis = require('redis')
const cache = require('./')

const request = (url = '/', headers = {}) => ({
  url,
  header: name => headers[name]
})

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

test('uses the existing URL and header cache key', () => {
  const req = request('/route?x=1', {
    accepts: 'application/json',
    'accept-encoding': 'gzip'
  })
  req.originalUrl = '/mount/route?x=1'
  dispatch(cache({ duration: 30 }), req)
  expect(client.get.mock.calls[0][0]).toBe('/route?x=1.application/json.gzip')
})

test('falls back to originalUrl when url is empty', () => {
  const req = request('')
  req.originalUrl = '/original'
  dispatch(cache({ duration: 30 }), req)
  expect(client.get.mock.calls[0][0]).toBe('/original.undefined.undefined')
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
    '/data.undefined.undefined',
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

test('a hit parses JSON, sends it, and continues once without rewriting it', () => {
  const { res, next } = dispatch(cache({ duration: 30 }))
  const originalSend = res.send
  reply(null, '{"answer":42}')
  expect(res.sendCached).toBe(originalSend)
  expect(res.send).toHaveBeenCalledTimes(1)
  expect(res.send).toHaveBeenCalledWith({ answer: 42 })
  expect(next).toHaveBeenCalledTimes(1)
  expect(next).toHaveBeenCalledWith()
  expect(client.setex).not.toHaveBeenCalled()
})

test('cached JSON primitives are passed to send unchanged', () => {
  ;['false', '0', 'null', '"text"'].forEach(value => {
    client.get.mockClear()
    const { res, next } = dispatch(cache({ duration: 30 }))
    reply(null, value)
    expect(res.send).toHaveBeenCalledWith(JSON.parse(value))
    expect(next).toHaveBeenCalledTimes(1)
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
    '/.undefined.undefined',
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
    ['/second.undefined.undefined', 30, '{"id":2}'],
    ['/first.undefined.undefined', 30, '{"id":1}']
  ])
  expect(first.res.send).toHaveBeenCalledWith({ id: 1 })
  expect(second.res.send).toHaveBeenCalledWith({ id: 2 })
  expect(first.next).toHaveBeenCalledTimes(1)
  expect(second.next).toHaveBeenCalledTimes(1)
})
