import { describeAccountKeysContract } from "#/storage/contracts/accountKeysContract.js";
import { describeAttachmentsContract } from "#/storage/contracts/attachmentsContract.js";
import { describeCommentsContract } from "#/storage/contracts/commentsContract.js";
import { describeOAuthContract } from "#/storage/contracts/oauthContract.js";
import { describePasskeysContract } from "#/storage/contracts/passkeysContract.js";
import { describePrefsContract } from "#/storage/contracts/prefsContract.js";
import { describePublicLinksContract } from "#/storage/contracts/publicLinksContract.js";
import { describePushContract } from "#/storage/contracts/pushContract.js";
import { describeStatsContract } from "#/storage/contracts/statsContract.js";
import { describeSyncContract } from "#/storage/contracts/syncContract.js";
import { describeTeamsContract } from "#/storage/contracts/teamsContract.js";
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

describeSyncContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describePublicLinksContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describeTeamsContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describeOAuthContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describePasskeysContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describeAccountKeysContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describeCommentsContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describePushContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);
