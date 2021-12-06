const axios = require('axios');
// const moment = require('moment');
const BPromise = require('bluebird')
const {v4: uuidv4} = require('uuid');
const TechcombankModel = require('../models/tcb.model')
const _ = require('lodash')
const numeral = require('numeral');
const moment = require('moment-timezone');
moment.tz.setDefault("Asia/Ho_Chi_Minh");

const commonHeader = {
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Pixel XL Build/QP1A.191005.007.A3; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/85.0.4183.101 Mobile Safari/537.36',
    'Content-Type': 'application/json',
    'X-Requested-With': 'com.fastacash.tcb',
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty',
    'Accept-Encoding': 'gzip, deflate',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
  };

function randomString(length, chars = '0123456789abcdefghijklmnopqrstuvwxyz') {
    let result = '';
    for (let i = length; i > 0; --i) result += chars[Math.floor(Math.random() * chars.length)];
    return result;
  }

const choiceBankAccount = async (account, accountNumber) => {
    const selected = _.find((account.customerAccountNumber || []), (a) => a.bankAccount && `${a.bankAccount.accountNumber}` === `${accountNumber}`) || {};
    // console.log('selected::', selected);
    return selected.customerId || account.customerId || 0;
};

const choiceAccount = async (account, accountNumber) => {
    const selected = _.find((account.customerAccountNumber || []), (a) => a.bankAccount && `${a.bankAccount.accountNumber}` === `${accountNumber}`) || {};
    // console.log('selected::', selected);
    return selected.instrumentIdNumber || account.instrumentIdNumber;
};

const checkTranHistory = async (account, accountNumber, fromTime, toTime, trytime = 1) => {
    console.info(
        '[techcombank] checking transaction history fromtime: %s totime: %s',
        fromTime,
        toTime
    );

    const paymentInstrumentId = await choiceAccount(account, accountNumber || '');
    // console.log('paymentInstrumentId: ', paymentInstrumentId);

    let begin = moment(fromTime, 'DD/MM/YYYY HH:mm:ss').format('YYYYMMDD');
    let end = moment(toTime, 'DD/MM/YYYY HH:mm:ss').format('YYYYMMDD');

    const body = {
        ...generateAdditionBody(account.deviceId),
        "maxRecords": "1000",
        fromDate: begin,
        toDate: end,
        "paymentInstrumentId": paymentInstrumentId || account.instrumentIdNumber
    }
    try {
        const checkTrans = await axios.post('https://m.techcombank.com.vn/mobiliser/rest/smartphone/findTcbTransactions', body, {
            headers: {
                Accept: "application/json",
                "User-Agent": "Mozilla/5.0 (Linux; Android 10; Pixel XL Build/QP1A.191005.007.A3; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/85.0.4183.101 Mobile Safari/537.36",
                "Content-Type": "application/json",
                "X-Requested-With": "com.fastacash.tcb",
                "Sec-Fetch-Site": "cross-site",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Dest": "empty",
                "Accept-Encoding": "gzip, deflate",
                "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
                Cookie: account.cookies
            }
        })
        const cookies = getCookieFromHeaders(checkTrans.headers, account.cookies);

        // console.log('checkTrans.data:', checkTrans.data);

        
        if (_.get(checkTrans, 'data.Status.code', 100) !== 0) return {
            success: false,
            message: _.get(checkTrans, 'data.Status.value', `Can not define techcombank transaction error`)
        }

        const transList = _.get(checkTrans, 'data.transactions', []);

        await TechcombankModel.findOneAndUpdate({username: account.username}, {$set: {cookies}}, {upsert: true})

        const adjustTransactions = transList.map((a) => {
            const transactionDate = moment(a.txnDate);
            return {
                CD: (a.txnAmount >= 0)?"+":"-",
                Reference: a.txnRef,
                TransID: a.txnRef,
                Amount: numeral(Math.abs(a.txnAmount)).format('0,0'),
                Description: a.txnDesc,
                TransactionDate: transactionDate.format('DD/MM/YYYY'),
                TransactionDateUnix: transactionDate.valueOf(),
                TransactionDateFull: transactionDate.format('DD/MM/YYYY HH:mm:ss'),
                PCTime: `${transactionDate.valueOf()}`,
                CurrentBalance: a.balanceAfterTxn
            }

        })

        // const incomeTransactions = transList.filter(b => b.txnAmount >= 0).map((a) => {
        //     return {
        //         TransID: a.txnRef,
        //         Amount: a.txnAmount,
        //         Description: a.txnDesc,
        //         TransactionDate: a.txnDate,
        //         CurrentBalance: a.balanceAfterTxn
        //     }

        // })
        return {success: true, transactions: adjustTransactions, raw_transactions: transList};
    }
    catch (e) {
        if (trytime === 0) return {
            success: false,
            message: `checkTranHistory error trytime = 0: ${e.message}`
        };

        if (e.message === 'Request failed with status code 401') {
            loginData = await login(account.username, account.password);
            if (!loginData.success) return loginData;
            
            const newAccount = await TechcombankModel.findOne({username: account.username}).lean();
            newAccount.password = account.password;
            return checkTranHistory(newAccount, accountNumber, fromTime, toTime, trytime - 1);
        } else {
            console.log('checkTranHistory:::', e);
            return {
                success: false,
                message: `checkTranHistory error: ${e.message}`
            };
        }
    }



};

const prepare = async (username, password) => {
    try {
        let loginData = {};

        let account = await TechcombankModel.findOne({username}).lean();

        // console.log('account:::', account);
        
        if (!account) {
            console.info('Account was not set up yet.')
            loginData = await login(username, password)
            if (!loginData.success) return loginData;

            await BPromise.delay(500)
            account = await TechcombankModel.findOne({username}).lean()
        }

        account.password = password;

        if (!account.cookies || (account.lastLogined && moment(account.lastLogined).add(4, 'minutes').isBefore(moment(new Date().toISOString())))) {
            console.log('account not logined 5 mins ago, begin logging in...');
            // do relogin here
            console.info(
                '[techcombank] relogin',
                username
            );
            account.password = password;
            loginData = await login(account.username, account.password || password)
            if (!loginData.success) return loginData;

            await BPromise.delay(500)
        }

        account = await TechcombankModel.findOne({username}).lean()
        
        return account;
    } catch (e) {
        throw e;
    }
}

const checkTranHistoryInRange = async (username, password, begin, end, accountNumber) => {
    console.info(
        '[techcombank] checking transaction phone: %s, accountNumber: %s, history fromtime: %s totime: %s',
        username,
        accountNumber,
        begin,
        end
    );

    const account = await prepare(username, password);

    const tranList = await checkTranHistory(account, accountNumber, begin, end);

    if (!tranList.success) tranList.transactions = [];

    return tranList
};

const getCookieFromHeaders = (headers, oldCookie = '') => {
    const Cookie = _.get(headers, 'set-cookie');
    // console.log(Cookie, oldCookie)
    const oldCookieArray = !oldCookie ? []: oldCookie.split(';').map((a) => {
        return {name: a.split('=')[0], value: a.split('=')[1]}
    })
    // console.log('sds', oldCookieArray)
    if (oldCookieArray.length > 0) {
        const cookieMobiler = _.find(oldCookieArray, (a) => a.name.includes('BIGipServer'));
        if (cookieMobiler) {
            return `${Cookie.map((cook) => {
                const split = cook.split(';');
                return split && split[0];
            }).join(';')}; ${cookieMobiler.name}=${cookieMobiler.value}`
        }


    }


    return Cookie.map((cook) => {
        const split = cook.split(';');
        return split && split[0];
    }).join(';');
};

function generateAdditionBody(deviceId = '1ebf8ca5ee692c36') {
    return {
        "origin": "MAPP",
        "traceNo": uuidv4(),
        "AuditData": {
            "device": "Android/10 Pixel XL",
            "deviceId": deviceId || "1ebf8ca5ee692c36",
            "otherDeviceId": "8.1.0",
            "application": "MAPP",
            "applicationVersion": '1.2.0.0'
        }
    }
};

const login = async (username, password) => {
    console.info(`[techcombank] retry to login`);
    const loginMobile = `https://m.techcombank.com.vn/mobiliser/rest/smartphone/loginTcbCustomer?uname=${username}&aid=1ebf8ca5ee692c36`
    const walletUri = 'https://m.techcombank.com.vn/mobiliser/rest/smartphone/getWalletEntriesByCustomer';

    if (!username || !password) {
        console.error(`[techcombank] username hoặc pass không đuợc để trống`);
        return {
            success: false,
            message: `[techcombank] username hoặc pass không đuợc để trống`
        }
    }
    try {
        const deviceId = randomString(16);
        const additionBody = generateAdditionBody(deviceId);

        const bodyLogin = {
            ...additionBody,
            "identification": username,
            "credential": password,
            "identificationType": "0",
            "credentialType": "0",
            "UnstructuredData": [{
                "Key": "DeviceToken",
                "Value": `[adr]eVGIVdLpeHE:APA91bFGfrhyDhyJQQiHW${randomString(5)}4yuIMWBQP8f51yA1MxWVKQxXCGtJwyah7Kb52ZVKTHRjQGHHnKFML22M9LzS-FRX3yrMc9_LwoDcjBUrYXDDBFMkZG7cZ9B36GtKGmuOJsSRmjkvnN`
            }, {
                "Key": "DeviceTime",
                "Value": `${moment().valueOf()}`
            }]
        }

        const firstHeader = await axios.post(loginMobile, bodyLogin, {
            headers: {
                Accept: "application/json",
                "User-Agent": "Mozilla/5.0 (Linux; Android 10; Pixel XL Build/QP1A.191005.007.A3; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/85.0.4183.101 Mobile Safari/537.36",
                "Content-Type": "application/json",
                "X-Requested-With": "com.fastacash.tcb",
                "Sec-Fetch-Site": "cross-site",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Dest": "empty",
                "Accept-Encoding": "gzip, deflate",
                "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
            },
        })

        // console.log(firstHeader.headers);
        // console.log(firstHeader.data);

        if (_.get(firstHeader, 'data.Status.code', 100) !== 0) {
            return {
                success: false,
                message: `[techcombank] Login ERROR: ${_.get(firstHeader, 'data.Status.value', 'Unknown error')}`
            }
        }


        const cookies = getCookieFromHeaders(firstHeader.headers, '');
        if (!cookies.includes('MOBILISER_REMEMBER_ME_COOKIE')) {
            console.log('[techcombank] login ERROR', 'Unknown Error')
            return {
                success: false,
                message: `[techcombank] login ERROR Unknown Error MOBILISER_REMEMBER_ME_COOKIE`
            }
        }

        await TechcombankModel.findOneAndUpdate({username}, {$set: {username, password: "", cookies, lastLogined: moment().valueOf()}}, {upsert: true})

        const customerId = _.get(firstHeader, 'data.customer.id', 0);

        if (!customerId) {
            return {
                success: false,
                message: `[techcombank] login ERROR: can not find customerId`
            };
        }

        const bodyWallet = {
            ...generateAdditionBody(deviceId),
            "customerId": _.get(firstHeader.data, 'customer.id', '')
        }

        const getWallet = await axios.post(walletUri, bodyWallet, {
            headers: {
                Accept: "application/json",
                "User-Agent": "Mozilla/5.0 (Linux; Android 10; Pixel XL Build/QP1A.191005.007.A3; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/85.0.4183.101 Mobile Safari/537.36",
                "Content-Type": "application/json",
                "X-Requested-With": "com.fastacash.tcb",
                "Sec-Fetch-Site": "cross-site",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Dest": "empty",
                "Accept-Encoding": "gzip, deflate",
                "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
                Cookie: cookies,
            },
        })

        const customerAccountNumber = _.get(getWallet, 'data.walletEntries', []);
        const accountNumber = _.find(customerAccountNumber, (a) => a.bankAccount);
        const newCookies = getCookieFromHeaders(getWallet.headers, cookies);
        await TechcombankModel.findOneAndUpdate({username}, {$set: {
            cookies: newCookies,
            customerId,
            deviceId,
            customerAccountNumber,
            instrumentIdNumber: accountNumber && accountNumber.paymentInstrumentId
        }}, {upsert: true})

        // console.log('[techcombank] login Success', firstHeader.headers, firstHeader.data);
        console.log('[techcombank] login Success');

        return {success: true, message: 'OK'};

    } catch (error) {
        console.error('[techcombank] login ERROR', error);
        return {
            success: false,
            message: `[techcombank] login ERROR: ${error.message}`
        };
    }
};

const getBalance = async (username, password, trytime = 0) => {
    if (trytime === 2) {
        return {
            success: false,
            message: `getBalance error trytime = ${trytime}: ${e.message}`
        };
    }
    console.info(
      '[techcombank] checking balance user:',
      username,
    );
  
    try {
      const account = await prepare(username, password);
      const customerId = await choiceBankAccount(account) || account.customerId;
      const {data: walletInfo} = await axios.post('https://fmb.techcombank.com.vn/mobiliser/rest/smartphone/getWalletEntriesByCustomer', {
        ...generateAdditionBody(account.deviceId),
        customerId: customerId,
      }, {
        headers: {
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0 (Linux; Android 10; Pixel XL Build/QP1A.191005.007.A3; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/85.0.4183.101 Mobile Safari/537.36",
            "Content-Type": "application/json",
            "X-Requested-With": "com.fastacash.tcb",
            "Sec-Fetch-Site": "cross-site",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Dest": "empty",
            "Accept-Encoding": "gzip, deflate",
            "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
            Cookie: account.cookies
        }
      });

      if (_.get(walletInfo, 'Status.code', 100) != 0) {
        return {
            success: false,
            message: `getBalance error: ${_.get(walletInfo, 'Status.value', 'unknown')}`
        };
      }
  
      const allList = _.get(walletInfo, 'walletEntries', []);
  
      if (allList.length === 0) {
        // relogin
        return {
          success: false,
          message: `getBalance error: allList is empty`
        };
      }
  
      const paymentInstrument = allList.filter((a) => a.bankAccount);
      const accountNumber = _.get(paymentInstrument, '0.bankAccount.accountNumber');
      const paymentInstrumentId = _.get(paymentInstrument, '0.paymentInstrumentId');
      const balance = _.get(paymentInstrument, '0.bankAccount.spareFields.spareInteger1');
      const accountHolderName = _.get(paymentInstrument, '0.bankAccount.accountHolderName');
      return {success: true, message: 'OK', accountNumber, paymentInstrumentId, balance, accountHolderName, raw: walletInfo};

    } catch (e) {
      //
      console.error('getBalance:::', e);
      return {
          success: false,
          message: `getBalance error: ${e.message}`
      };
    }
}

module.exports = {
    checkTranHistoryInRange,
    login, getBalance
};
