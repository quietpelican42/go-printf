import { float32, float64, int64, sprintf, uint8 } from '../src/index.ts';

console.log(sprintf('%06d|%+.2f|%-8s|%x', 42, 3.14159, 'go', 255));
console.log(sprintf('%v %v %v', 1e6, float64(1e6), float32(0.1)));
console.log(sprintf('%d %d', uint8(300), int64(2n ** 63n)));
console.log(sprintf('%q %+q %#q', 'tab\there', '日本', 'raw'));
console.log(sprintf('%d %s', 'x', 5));
console.log(sprintf('%[2]d %[1]d|%[1]*d', 5, 42));
