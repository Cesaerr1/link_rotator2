const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');

const health = require('./routes/health');
const pixel = require('./routes/pixel');
const track = require('./routes/track');
const links = require('./routes/links');

module.exports = function makeApp() {
  const app = express();
  app.use(helmet({ crossOriginResourcePolicy:false }));
  app.use(express.json({ limit: '64kb' }));
  app.use(cors());
  app.use(morgan('combined'));

  app.use('/', health);
  app.use('/', pixel);
  app.use('/', track);
  app.use('/links', links);

  app.use((_req,_res,next)=>next(Object.assign(new Error('Not Found'),{status:404})));
  app.use((err,_req,res,_next)=>res.status(err.status||500).json({ok:false,error:err.message||'server_error'}));
  return app;
};
