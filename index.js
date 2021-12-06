require('dotenv').config();
const bodyParser = require('body-parser');
const cors = require('cors');
const express = require('express');

const MongoDB = require('./connections/mongodb');
const {PORT} = require('./configs/variables.config');
const TCBService = require('./services/tcb.service');

// init connection to MongoDB
MongoDB.initConnnection();
// express section
const app = express();


app.use(cors());
// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({extended: false}));

// parse application/json
app.use(bodyParser.json());


app.get('/', (req, res) => {
  // fake down service endpoint
  res.status(502).send();
})

// get bank balance

app.post('/api/techcombank/getBalance', async (req, res) => {
  const {username, password} = req.body;
  try {
    const data = await TCBService.getBalance(username, password);
    res.status(200).json(data);
  } catch (err) {
    res.status(200).json({ success: false, message: `Server error: ${err.message}` });
  }

})

app.post('/api/techcombank/getTransactions', async (req, res) => {
  const {username, password, begin, end} = req.body;
  try {
    const data = await TCBService.checkTranHistoryInRange(username, password, begin, end);
    res.status(200).json(data);
  } catch (err) {
    res.status(200).json({ success: false, message: `Server error: ${err.message}` });
  }
})


// end routing section.
app.listen(PORT, () => {
  console.log('Server is running on port', PORT);
});

