const express = require('express')
const app = express()

const cache = require('./')

app.use(cache({duration: 30, redis: {port: 6379}}))

app.get('/', (req, res) => {
  res.send({test: true})
})

app.listen(8000)
