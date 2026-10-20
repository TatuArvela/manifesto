import { describeAccountKeysContract } from "#/storage/contracts/accountKeysContract.ts";
import { describeAdminContract } from "#/storage/contracts/adminContract.ts";
import { describeAttachmentsContract } from "#/storage/contracts/attachmentsContract.ts";
import { describeCommentsContract } from "#/storage/contracts/commentsContract.ts";
import { describeNoteFormatContract } from "#/storage/contracts/noteFormatContract.ts";
import { describeOAuthContract } from "#/storage/contracts/oauthContract.ts";
import { describePasskeysContract } from "#/storage/contracts/passkeysContract.ts";
import { describePrefsContract } from "#/storage/contracts/prefsContract.ts";
import { describePublicLinksContract } from "#/storage/contracts/publicLinksContract.ts";
import { describePushContract } from "#/storage/contracts/pushContract.ts";
import { describeSharingContract } from "#/storage/contracts/sharingContract.ts";
import { describeStatsContract } from "#/storage/contracts/statsContract.ts";
import { describeSyncContract } from "#/storage/contracts/syncContract.ts";
import { describeTeamsContract } from "#/storage/contracts/teamsContract.ts";
import { createPostgresStorage, type PostgresStorageDriver } from "./driver.ts";
import { newMigratedTestPool } from "./testDb.ts";

// Apart from `driver.test.ts`, so that the two files run in parallel.
async function bootStorage(): Promise<PostgresStorageDriver> {
  const pool = await newMigratedTestPool();
  return createPostgresStorage(
    { connectionString: "postgres://test" },
    { poolFactory: () => pool },
  );
}

describeAdminContract("postgres (PGlite)", bootStorage);
describeSharingContract("postgres (PGlite)", bootStorage);
describeAttachmentsContract("postgres (PGlite)", bootStorage);
describeStatsContract("postgres (PGlite)", bootStorage);
describeSyncContract("postgres (PGlite)", bootStorage);
describePublicLinksContract("postgres (PGlite)", bootStorage);
describeTeamsContract("postgres (PGlite)", bootStorage);
describeOAuthContract("postgres (PGlite)", bootStorage);
describePasskeysContract("postgres (PGlite)", bootStorage);
describeAccountKeysContract("postgres (PGlite)", bootStorage);
describeCommentsContract("postgres (PGlite)", bootStorage);
describePushContract("postgres (PGlite)", bootStorage);
describeNoteFormatContract("postgres (PGlite)", bootStorage);
describePrefsContract("postgres (PGlite)", bootStorage);
