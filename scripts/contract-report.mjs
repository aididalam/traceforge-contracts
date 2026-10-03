import { readFile } from "node:fs/promises";

const artifactPath =
  "artifacts/contracts/TraceForge.sol/TraceForge.json";

const artifact = JSON.parse(
  await readFile(artifactPath, "utf8"),
);

const runtimeBytecode =
  artifact.deployedBytecode;

const creationBytecode =
  artifact.bytecode;

if (
  typeof runtimeBytecode !== "string" ||
  typeof creationBytecode !== "string"
) {
  throw new Error(
    "Artifact does not contain expected bytecode."
  );
}

const runtimeBytes =
  (runtimeBytecode.length - 2) / 2;

const creationBytes =
  (creationBytecode.length - 2) / 2;

const eip170Limit = 24_576;

const functions = artifact.abi.filter(
  (item) => item.type === "function",
);

const events = artifact.abi.filter(
  (item) => item.type === "event",
);

const errors = artifact.abi.filter(
  (item) => item.type === "error",
);

console.log("TraceForge Contract Report");
console.log("==========================");
console.log();

console.log(`Creation bytecode: ${creationBytes.toLocaleString()} bytes`);
console.log(`Runtime bytecode:  ${runtimeBytes.toLocaleString()} bytes`);
console.log(`EIP-170 limit:     ${eip170Limit.toLocaleString()} bytes`);
console.log(
  `Remaining:         ${(eip170Limit - runtimeBytes).toLocaleString()} bytes`,
);

console.log();

console.log(`Functions: ${functions.length}`);
console.log(`Events:    ${events.length}`);
console.log(`Errors:    ${errors.length}`);

console.log();

console.log("Public / external functions");
console.log("---------------------------");

for (const fn of functions) {
  console.log(
    `${fn.stateMutability.padEnd(10)} ${fn.name}`,
  );
}

console.log();

console.log("Events");
console.log("------");

for (const event of events) {
  console.log(event.name);
}

console.log();

console.log("Custom errors");
console.log("-------------");

for (const error of errors) {
  console.log(error.name);
}

if (runtimeBytes > eip170Limit) {
  console.error();
  console.error(
    "FAIL: runtime bytecode exceeds EIP-170 limit.",
  );
  process.exit(1);
}

console.log();
console.log(
  "PASS: runtime bytecode is within EIP-170 limit.",
);
