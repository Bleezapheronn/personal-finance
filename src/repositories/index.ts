import * as accountRepositoryModule from "./accountRepository";
import * as budgetRepositoryModule from "./budgetRepository";
import * as categoryRepositoryModule from "./categoryRepository";
import * as recipientRepositoryModule from "./recipientRepository";
import * as reportRepositoryModule from "./reportRepository";
import * as smsImportTemplateRepositoryModule from "./smsImportTemplateRepository";
import * as transactionRepositoryModule from "./transactionRepository";
import * as httpReadonlyRepositoryModules from "./http";

export * as accountRepository from "./accountRepository";
export * as categoryRepository from "./categoryRepository";
export * as recipientRepository from "./recipientRepository";
export * as transactionRepository from "./transactionRepository";
export * as budgetRepository from "./budgetRepository";
export * as reportRepository from "./reportRepository";
export * as smsImportTemplateRepository from "./smsImportTemplateRepository";
export * from "./adapterSelection";
export * from "./selectedReadRepositories";

export const dexieRepositories = {
  accountRepository: accountRepositoryModule,
  categoryRepository: categoryRepositoryModule,
  recipientRepository: recipientRepositoryModule,
  transactionRepository: transactionRepositoryModule,
  budgetRepository: budgetRepositoryModule,
  reportRepository: reportRepositoryModule,
  smsImportTemplateRepository: smsImportTemplateRepositoryModule,
};

export const httpReadonlyRepositories = httpReadonlyRepositoryModules;
