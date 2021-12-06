// define mongo uri
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/techcombank';
// define port for service
const PORT = process.env.PORT || 6789;

module.exports = {
  MONGO_URI,
  PORT
}
