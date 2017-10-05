
<h1 align="center">moola-redis</h1>
<div align="center">
  <strong>Express-style redis cache middleware</strong>
</div>
<br>
<div align="center">
  <a href="https://npmjs.org/package/moola-redis">
    <img src="https://img.shields.io/npm/v/moola-redis.svg?style=flat-square" alt="npm package version" />
  </a>
  <a href="https://npmjs.org/package/moola-redis">
  <img src="https://img.shields.io/npm/dm/moola-redis.svg?style=flat-square" alt="npm downloads" />
  </a>
  <a href="https://github.com/feross/standard">
    <img src="https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat-square" alt="standard JS linter" />
  </a>
  <a href="https://github.com/prettier/prettier">
    <img src="https://img.shields.io/badge/styled_with-prettier-ff69b4.svg?style=flat-square" alt="prettier code formatting" />
  </a>
  <a href="https://travis-ci.org/tiaanduplessis/moola-redis">
    <img src="https://img.shields.io/travis/tiaanduplessis/moola-redis.svg?style=flat-square" alt="travis ci build status" />
  </a>
  <a href="https://github.com/tiaanduplessis/moola-redis/blob/master/LICENSE">
    <img src="https://img.shields.io/npm/l/moola-redis.svg?style=flat-square" alt="project license" />
  </a>
  <a href="http://makeapullrequest.com">
    <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square" alt="make a pull request" />
  </a>
</div>
<br>
<div align="center">
  <a href="https://github.com/tiaanduplessis/moola-redis/watchers">
    <img src="https://img.shields.io/github/watchers/tiaanduplessis/moola-redis.svg?style=social" alt="Github Watch Badge" />
  </a>
  <a href="https://github.com/tiaanduplessis/moola-redis/stargazers">
    <img src="https://img.shields.io/github/stars/tiaanduplessis/moola-redis.svg?style=social" alt="Github Star Badge" />
  </a>
  <a href="https://twitter.com/intent/tweet?text=Check%20out%20moola-redis!%20https://github.com/tiaanduplessis/moola-redis%20%F0%9F%91%8D">
    <img src="https://img.shields.io/twitter/url/https/github.com/tiaanduplessis/moola-redis.svg?style=social" alt="Tweet" />
  </a>
</div>
<br>
<div align="center">
  Built with ❤︎ by <a href="https://github.com/tiaanduplessis">tiaanduplessis</a> and <a href="https://github.com/tiaanduplessis/moola-redis/contributors">contributors</a>
</div>

<h2>Table of Contents</h2>
<details>
  <summary>Table of Contents</summary>
  <li><a href="#install">Install</a></li>
  <li><a href="#api">API</a></li>
  <li><a href="#usage">Usage</a></li>
  <li><a href="#contribute">Contribute</a></li>
  <li><a href="#license">License</a></li>
</details>

## Install

[![Greenkeeper badge](https://badges.greenkeeper.io/tiaanduplessis/moola-redis.svg)](https://greenkeeper.io/)

```sh
$ npm install moola-redis
# OR
$ yarn add moola-redis
```

## Usage

```js
const express = require('express')
const app = express()

const cache = require('moola-redis')

app.use(cache({duration: 30, redis: {port: 6379}}))

app.get('/', (req, res) => {
  res.send({test: true})
})

app.listen(8000)
```

## API

### `cache(options: Object)`

Creates cache middleware with options:
- `redis: Object` - Standard configuration options for [redis client](https://www.npmjs.com/package/redis#rediscreateclient)
- `duration: Number` - Amount in seconds to cache for

## Contributing

Contributions are welcome!

1. Fork it.
2. Create your feature branch: `git checkout -b my-new-feature`
3. Commit your changes: `git commit -am 'Add some feature'`
4. Push to the branch: `git push origin my-new-feature`
5. Submit a pull request :D

Or open up [a issue](https://github.com/tiaanduplessis/moola-redis/issues).

## License

Licensed under the MIT License.
