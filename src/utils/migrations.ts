import { db } from "../db";

interface MigrationResult {
  table: string;
  updated: number;
  total: number;
  timestamp: Date;
}

/**
 * Migration: Ensure all records have explicit isActive boolean values
 * Sets isActive = true for any records where isActive is undefined
 * This ensures backward compatibility with existing data
 */
export const migrateIsActiveStates = async (): Promise<void> => {
  console.log("🔄 Starting isActive migration...");

  const results: MigrationResult[] = [];
  const tables = [
    { name: "accounts", table: db.accounts },
    { name: "recipients", table: db.recipients },
    { name: "categories", table: db.categories },
    { name: "buckets", table: db.buckets },
    { name: "paymentMethods", table: db.paymentMethods },
    { name: "smsImportTemplates", table: db.smsImportTemplates },
  ];

  try {
    for (const { name, table } of tables) {
      const allRecords = await table.toArray();
      const recordsToUpdate = allRecords.filter(
        (record: any) => record.isActive === undefined
      );

      if (recordsToUpdate.length > 0) {
        // Update all records with undefined isActive to true
        const updates = recordsToUpdate.map((record: any) => ({
          ...record,
          isActive: true,
        }));

        for (const record of updates) {
          await table.update(record.id, { isActive: true });
        }

        results.push({
          table: name,
          updated: recordsToUpdate.length,
          total: allRecords.length,
          timestamp: new Date(),
        });

        console.log(
          `✅ ${name}: Updated ${recordsToUpdate.length} records (${allRecords.length} total)`
        );
      } else {
        console.log(
          `✅ ${name}: All ${allRecords.length} records already valid`
        );
      }
    }

    // Log summary
    const totalUpdated = results.reduce((sum, r) => sum + r.updated, 0);
    if (totalUpdated > 0) {
      console.log(`\n📊 Migration Summary:`);
      console.log(`Total records updated: ${totalUpdated}`);
      results.forEach((r) => {
        console.log(`  - ${r.table}: ${r.updated}/${r.total} records updated`);
      });
      console.log("\n✨ isActive migration completed successfully!");
    } else {
      console.log(
        "✨ No updates needed - all records already have isActive set"
      );
    }
  } catch (error) {
    console.error("❌ Error during isActive migration:", error);
    throw error;
  }
};

/**
 * Run all pending migrations
 * Call this once on app startup (in App.tsx useEffect)
 */
export const runAllMigrations = async (): Promise<void> => {
  try {
    await migrateIsActiveStates();
  } catch (error) {
    console.error("❌ Migration failed:", error);
    // Don't throw - let app continue even if migration fails
    // This prevents app from breaking if migration has issues
  }
};
