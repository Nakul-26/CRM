/** Unit tests only — no live database required. Run `pnpm test:e2e` for integration tests. */
module.exports = {
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  transform: { "^.+\\.ts$": "ts-jest" },
  moduleFileExtensions: ["js", "json", "ts"],
  testEnvironment: "node",
  collectCoverageFrom: ["**/*.ts", "!**/*.spec.ts", "!**/*.module.ts", "!main.ts"],
};
