'use strict'

const assert = require('assert')

const json = require('@tiaanduplessis/json')
const redis = require('redis')

const moolaRedis = (opts = {}) => {
  const { duration, redisOpts } = opts

  assert.equal(typeof duration, 'number', 'duration should be a number')
  assert.equal(typeof redis, 'object', 'redis should be a object of options')

  const client = redis.createClient(redisOpts)

  const handler = (req, res, next) => {
    const key = `${req.url || req.originalUrl}.${req.header(
      'accepts'
    )}.${req.header('accept-encoding')}`

    client.get(key, (error, value) => {
      if (error) {
        next(error)
        return
      }

      res.sendCached = res.send

      if (value) {
        json.parse(value, (error, data) => {
          if (error) {
            next(error)
            return
          }
          res.send(data)
          next()
        })
      } else {
        res.sendCached = body => {
          const str = json.stringify(body)
          client.setex(key, duration, str)
          res.send(body)
        }
        next()
      }
    })
  }

  return handler
}

module.exports = moolaRedis
