function fmtMoney(n) {
  const v = Number(n || 0);
  return (Number.isFinite(v) ? v : 0).toFixed(2);
}
module.exports = { fmtMoney };
