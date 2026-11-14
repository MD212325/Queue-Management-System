'use strict';
const os = require('os');

const isPrivate = a => /^10\./.test(a) || /^192\.168\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a);

/** This computer's addresses on private networks (Wi-Fi / LAN), the ones phones in the building can reach. */
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      const v4 = a.family === 'IPv4' || a.family === 4;
      if (v4 && !a.internal && isPrivate(a.address)) out.push({ address: a.address, interface: name });
    }
  }
  return out;
}

module.exports = { lanAddresses, isPrivate };
