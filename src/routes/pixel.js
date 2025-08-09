const router = require('express').Router();

router.get('/tracking-pixel.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  const script = `
(function(){
  try {
    var el = document.currentScript;
    var qs = new URLSearchParams((el && el.src && el.src.split('?')[1]) || '');
    var amount = el && el.getAttribute('data-amount');
    if (!amount) amount = qs.get('amount');
    var token = qs.get('token') || (el && el.getAttribute('data-token')) || '';
    var lid = qs.get('lid') || (el && el.getAttribute('data-lid')) || '';
    if (!amount && typeof window.STRIPE_SALE_AMOUNT !== 'undefined') amount = window.STRIPE_SALE_AMOUNT;
    amount = parseFloat(amount);
    if (!isFinite(amount) || amount <= 0) return;

    var origin = (function(){ try { return new URL(el.src).origin; } catch(e) { return location.origin; } })();
    var host = location.host;
    var today = (new Date()).toISOString().slice(0,10);
    var key = 'trk:'+host+':'+(lid||'-')+':'+amount+':'+today;
    if (sessionStorage.getItem(key)) return;

    fetch(origin + '/track', {
      method:'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ amount: amount, host: host, token: token, lid: lid })
    }).then(function(r){ return r.json(); })
      .then(function(_){ sessionStorage.setItem(key,'1'); })
      .catch(function(_){ });
  } catch(e) { }
})();`;
  res.send(script);
});

module.exports = router;
