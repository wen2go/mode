'use strict';

if (document.getElementById('app').textContent !== 'fixture') {
  throw new Error('initial HTML is unavailable');
}
document.cookie = `storage=${localStorage.getItem('marker') === null ? 'fresh' : 'leaked'}`;
localStorage.setItem('marker', 'present');
document.cookie = 'external=ok; Path=/';
