const mongoose = require('mongoose');

const { MONGO_URI } = require('../configs/variables.config');

class MongoDB {
  static initConnnection() {
    // mongoose instance connection url connection
    mongoose.Promise = global.Promise;
    mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
  }
}
module.exports = MongoDB;
