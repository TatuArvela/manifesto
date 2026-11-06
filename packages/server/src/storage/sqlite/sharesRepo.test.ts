import { describeSharedNotesContract } from "#/storage/contracts/sharedNotesContract.ts";
import { describeSharingContract } from "#/storage/contracts/sharingContract.ts";
import { createSqliteStorage } from "./driver.ts";

describeSharingContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);
describeSharedNotesContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);
