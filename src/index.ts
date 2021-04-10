import readline from "readline"
import fs from "fs"
import {chunk, groupBy} from "lodash"
import net from "net"
import axios from "axios"
import dotenv from "dotenv"
import cliProgress from "cli-progress"

dotenv.config()

function trimTrailingSlash(text: string): string {
    return text?.replace(/\/*$/ui, '');
}

if (typeof process.env.SERVER_URL === "undefined") {
    console.error("The SERVER_URL environment variable hasn't been set.")
    process.exit(1)
}

const serverUrl = trimTrailingSlash(process.env.SERVER_URL)

if (process.platform !== "linux") {
    console.error(`This program can only be run on Linux systems for now. Your current OS is ${process.platform}.`)
    process.exit(1)
}

const hostsFilePath = `/etc/hosts`

try {
    fs.accessSync(hostsFilePath, fs.constants.R_OK | fs.constants.W_OK)
} catch (error) {
    console.error(`The file "${hostsFilePath}" is either unreadable or unwritable. Try running this program as admin / root.`)
    process.exit(1)
}

interface Renderable {}

interface Entry extends Renderable {
    lineIndex: number,
    ipAddress: string;
    domains: string[],
}

interface NewEntry extends Renderable {
    ipAddress: string;
    domains: string[],
}

interface EntryGroup extends Renderable {
    entries: Entry[],
}

interface ApiResponse {
    status: number,
    message: string,
    ip_addresses: string[]
}

function isEntryGroup(object: any): object is EntryGroup {
    return object.hasOwnProperty("entries")
}

function isAnyEntry(object: any): object is (Entry | NewEntry) {
    return object.hasOwnProperty('ipAddress') && object.hasOwnProperty('domains')
}

let lineModels = new Map<number, (string | Renderable)>()
let lineIndex = -1

function renderEntry(lineModel: Entry | NewEntry) {
    return `${lineModel.ipAddress} ${lineModel.domains.join(' ')}`;
}

function saveToFile(outputFile: string): void {
    let lines: string[] = []

    lineModels.forEach(lineModel => {
        if (typeof lineModel === "string") {
            lines.push(lineModel)
            return
        }

        if (isAnyEntry(lineModel)) {
            lines.push(renderEntry(lineModel))
            return
        }

        if (isEntryGroup(lineModel)) {
            for (const entry of lineModel.entries) {
                lines.push(renderEntry(entry))
            }
            return;
        }
    })

    fs.writeFileSync(outputFile, lines.join("\n"))
}

readline.createInterface({
    input: fs.createReadStream(hostsFilePath)
}).on('line', line => {
    ++lineIndex
    line = line.trim()

    if ((line.length === 0) || line.startsWith('#')) {
        lineModels.set(lineIndex, line)
        return
    }

    let parts = line.split(/ +/ui)
    if (parts.length < 2) {
        return
    }

    lineModels.set(lineIndex, {
        lineIndex: lineIndex,
        ipAddress: parts[0],
        domains: parts.slice(1),
    })
}).on('close', () => {
    let entries = Array.from(lineModels.values())
        .filter((lineModel): lineModel is Entry => isAnyEntry(lineModel))
        .filter(entry => !net.isIPv6(entry.ipAddress))
        .filter(entry => entry.ipAddress !== `127.0.0.1`)

    // Split to 10
    const chunkSize = Math.ceil(entries.length / 10)
    const chunks = chunk<Entry>(entries, chunkSize)

    const multiBar = new cliProgress.MultiBar({
        clearOnComplete: false,
        hideCursor: true
    }, cliProgress.Presets.shades_classic)

    Promise.all(
        chunks.map(
            async (chunk) => {
                const count = chunk.reduce((accu, next) => accu + next.domains.length, 0)
                const currentBar = multiBar.create(count, 0)

                await Promise.all(
                    chunk.map(async (entry, entryIndex) => {
                        let tempMap: {
                            domain: string,
                            ipAddress: string,
                        }[] = []

                        await Promise.all(
                            entry.domains.map(async (domain, domainIndex) => {
                                try {
                                    let response = await axios.get<ApiResponse>(`${serverUrl}?domain=${domain}`)

                                    if ((response.data.status === 200) && (response.data.ip_addresses.length > 0)) {
                                        tempMap.push({
                                            domain: domain,
                                            ipAddress: response.data.ip_addresses[0],
                                        })
                                    }

                                    currentBar.increment()
                                    multiBar.stop()
                                } catch (e) {
                                    // NOOP
                                }
                            })
                        )

                        const tempMapGroup = groupBy(tempMap, (item) => item.ipAddress)
                        const ipAddresses = Object.keys(tempMapGroup)

                        if (ipAddresses.length === 1) {
                            const firstGroupMember = tempMapGroup[ipAddresses[0]]

                            lineModels.set(
                                entry.lineIndex,
                                {
                                    lineIndex: lineIndex,
                                    ipAddress: ipAddresses[0],
                                    domains: firstGroupMember.map(mem => mem.domain),
                                }
                            )
                        } else if (ipAddresses.length > 1) {
                            const firstGroupMember = tempMapGroup[ipAddresses[0]]

                            const arrayOfEntries: NewEntry[] = Object.keys(tempMapGroup)
                                .map(ipAddress => ({
                                    lineIndex: typeof entry.lineIndex !== "undefined" ? ++entry.lineIndex : undefined,
                                    ipAddress: ipAddress,
                                    domains: tempMapGroup[ipAddress].map(pair => pair.domain)
                                }))

                            lineModels.set(
                                entry.lineIndex,
                                arrayOfEntries,
                            )
                        }
                    })
                )
            }
        )
    ).then(() => {
        multiBar.stop()
        saveToFile(hostsFilePath);
    })
})






