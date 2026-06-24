// state.js — shared mutable process state (imported by queue.js and stats.js)

let connectRunning = false;

export const getRunning = () => connectRunning;
export const setRunning = (val) => { connectRunning = !!val; };
