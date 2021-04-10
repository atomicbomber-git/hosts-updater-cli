import fs from "fs"

const delay = (n: number, label: string) => new Promise(resolve => {
    console.log(`START ${label}: Delaying for ${n} milliseconds...`)

    setTimeout(() => {
        console.log(`FINISHED ${label}`)
        resolve([n, label])
    }, n)
})

let times: number[] = [1000, 2000, 3000]

Promise.all(times.map(async (time, timeIndex) => {
    await delay(time, `${timeIndex}`)
})).then(() => {
    console.log("Done...")
})