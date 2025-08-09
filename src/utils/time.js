const moment = require('moment-timezone');
const nowISO = () => new Date().toISOString();
module.exports = { nowISO, moment };
