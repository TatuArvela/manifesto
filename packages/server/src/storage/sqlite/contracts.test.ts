import { describeAttachmentsContract } from "../attachmentsContract.js";
import { describePrefsContract } from "../prefsContract.js";
import { describeStatsContract } from "../statsContract.js";
import { createSqliteStorage } from "./driver.js";

describeAttachmentsContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describeStatsContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describePrefsContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);
