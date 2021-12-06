const mongoose = require('mongoose');

const { Schema } = mongoose;

const TechcombankModel = new Schema(
    {
        username: {
            type: String, unique: true, index: true
        },
        password: {
            type: String,
        },
        deviceId: {type: String},
        balance: {type: Number},
        cookies: {
            type: String,
        },
        customerId: {type: String},
        instrumentIdNumber: {type: String},
        customerAccountNumber: {type: Array},
        lastLogined: {
            type: Number
        }
    },
    { timestamps: true },
);

module.exports = mongoose.model('Techcombank', TechcombankModel);
