'use strict'

const fs = require('fs')
const path = require('path')
const pkg = require('./package.json')

test('ships only the middleware runtime dependencies', () => {
  expect(pkg.dependencies).toEqual({
    '@tiaanduplessis/json': '^1.1.2',
    redis: '^2.7.1'
  })
})

test('does not retain unused add or yarn entries in the lockfile', () => {
  const lock = fs.readFileSync(path.join(__dirname, 'yarn.lock'), 'utf8')
  expect(lock).toMatch(/^"@tiaanduplessis\/json@\^1\.1\.2":$/m)
  expect(lock).toMatch(/^redis@\^2\.7\.1:$/m)
  expect(lock).not.toMatch(/^"?(?:add|yarn)@/m)
})
