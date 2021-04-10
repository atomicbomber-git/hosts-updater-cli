"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const delay = (n, label) => new Promise(resolve => {
    console.log(`START ${label}: Delaying for ${n} milliseconds...`);
    setTimeout(() => {
        console.log(`FINISHED ${label}`);
        resolve([n, label]);
    }, n);
});
let times = [1000, 2000, 3000];
Promise.all(times.map(async (time, timeIndex) => {
    await delay(time, `${timeIndex}`);
})).then(() => {
    console.log("Done...");
});
//# sourceMappingURL=test.js.map