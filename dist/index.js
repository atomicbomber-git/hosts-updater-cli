"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const readline_1 = __importDefault(require("readline"));
const fs_1 = __importDefault(require("fs"));
const lodash_1 = require("lodash");
const net_1 = __importDefault(require("net"));
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
const cli_progress_1 = __importDefault(require("cli-progress"));
dotenv_1.default.config();
function trimTrailingSlash(text) {
    return text?.replace(/\/*$/ui, '');
}
if (typeof process.env.SERVER_URL === "undefined") {
    console.error("The SERVER_URL environment variable hasn't been set.");
    process.exit(1);
}
const serverUrl = trimTrailingSlash(process.env.SERVER_URL);
if (process.platform !== "linux") {
    console.error(`This program can only be run on Linux systems for now. Your current OS is ${process.platform}.`);
    process.exit(1);
}
const hostsFilePath = `/etc/hosts`;
try {
    fs_1.default.accessSync(hostsFilePath, fs_1.default.constants.R_OK | fs_1.default.constants.W_OK);
}
catch (error) {
    console.error(`The file "${hostsFilePath}" is either unreadable or unwritable. Try running this program as admin / root.`);
    process.exit(1);
}
function isEntryGroup(object) {
    return object.hasOwnProperty("entries");
}
function isAnyEntry(object) {
    return object.hasOwnProperty('ipAddress') && object.hasOwnProperty('domains');
}
let lineModels = new Map();
let lineIndex = -1;
function renderEntry(lineModel) {
    return `${lineModel.ipAddress} ${lineModel.domains.join(' ')}`;
}
function saveToFile(outputFile) {
    let lines = [];
    lineModels.forEach(lineModel => {
        if (typeof lineModel === "string") {
            lines.push(lineModel);
            return;
        }
        if (isAnyEntry(lineModel)) {
            lines.push(renderEntry(lineModel));
            return;
        }
        if (isEntryGroup(lineModel)) {
            for (const entry of lineModel.entries) {
                lines.push(renderEntry(entry));
            }
            return;
        }
    });
    fs_1.default.writeFileSync(outputFile, lines.join("\n"));
}
readline_1.default.createInterface({
    input: fs_1.default.createReadStream(hostsFilePath)
}).on('line', line => {
    ++lineIndex;
    line = line.trim();
    if ((line.length === 0) || line.startsWith('#')) {
        lineModels.set(lineIndex, line);
        return;
    }
    let parts = line.split(/ +/ui);
    if (parts.length < 2) {
        return;
    }
    lineModels.set(lineIndex, {
        lineIndex: lineIndex,
        ipAddress: parts[0],
        domains: parts.slice(1),
    });
}).on('close', () => {
    let entries = Array.from(lineModels.values())
        .filter((lineModel) => isAnyEntry(lineModel))
        .filter(entry => !net_1.default.isIPv6(entry.ipAddress))
        .filter(entry => entry.ipAddress !== `127.0.0.1`);
    // Split to 10
    const chunkSize = Math.ceil(entries.length / 10);
    const chunks = lodash_1.chunk(entries, chunkSize);
    const multiBar = new cli_progress_1.default.MultiBar({
        clearOnComplete: false,
        hideCursor: true
    }, cli_progress_1.default.Presets.shades_classic);
    Promise.all(chunks.map(async (chunk) => {
        const count = chunk.reduce((accu, next) => accu + next.domains.length, 0);
        const currentBar = multiBar.create(count, 0);
        await Promise.all(chunk.map(async (entry, entryIndex) => {
            let tempMap = [];
            await Promise.all(entry.domains.map(async (domain, domainIndex) => {
                try {
                    let response = await axios_1.default.get(`${serverUrl}?domain=${domain}`);
                    if ((response.data.status === 200) && (response.data.ip_addresses.length > 0)) {
                        tempMap.push({
                            domain: domain,
                            ipAddress: response.data.ip_addresses[0],
                        });
                    }
                    currentBar.increment();
                    multiBar.stop();
                }
                catch (e) {
                    // NOOP
                }
            }));
            const tempMapGroup = lodash_1.groupBy(tempMap, (item) => item.ipAddress);
            const ipAddresses = Object.keys(tempMapGroup);
            if (ipAddresses.length === 1) {
                const firstGroupMember = tempMapGroup[ipAddresses[0]];
                lineModels.set(entry.lineIndex, {
                    lineIndex: lineIndex,
                    ipAddress: ipAddresses[0],
                    domains: firstGroupMember.map(mem => mem.domain),
                });
            }
            else if (ipAddresses.length > 1) {
                const firstGroupMember = tempMapGroup[ipAddresses[0]];
                const arrayOfEntries = Object.keys(tempMapGroup)
                    .map(ipAddress => ({
                    lineIndex: typeof entry.lineIndex !== "undefined" ? ++entry.lineIndex : undefined,
                    ipAddress: ipAddress,
                    domains: tempMapGroup[ipAddress].map(pair => pair.domain)
                }));
                lineModels.set(entry.lineIndex, arrayOfEntries);
            }
        }));
    })).then(() => {
        multiBar.stop();
        saveToFile(hostsFilePath);
    });
});
//# sourceMappingURL=index.js.map