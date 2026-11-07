import { readFileSync } from 'node:fs';
import { validObservation } from '../src/protocol.js';
const event = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (!validObservation(event, new Date(`${event.observed_at}T12:00:00Z`))) throw new Error('Compiler event rejected by collector protocol');
console.log('Compiler event accepted by collector protocol');
