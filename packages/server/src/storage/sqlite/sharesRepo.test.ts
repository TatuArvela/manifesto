import { describeSharingContract } from "#/storage/contracts/sharingContract.js";
import { createSqliteStorage } from "./driver.js";

describeSharingContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);
