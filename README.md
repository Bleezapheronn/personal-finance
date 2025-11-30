# Personal Finance Tracker

A cross-platform mobile app to track expenses, manage multiple accounts, sync M-Pesa transactions, and generate detailed spending reports. Built with a focus on **privacy**, **ease of use**, and **fast data entry** for daily financial habits.

## 🎯 Problem & Solution

**Problem:** Most finance apps require cloud sync, lack offline support, or compromise on privacy. Users need a simple way to track daily expenses across multiple payment methods without worrying about data security.

**Solution:** Personal Finance Tracker is an **offline-first** app that:

- ✅ Works completely offline (no internet required)
- ✅ Stores data locally on your device (privacy-first)
- ✅ Syncs M-Pesa transactions automatically via SMS scraping
- ✅ Categorizes expenses intelligently for better insights
- ✅ Generates comprehensive spending reports

**Target Users:**

- Mobile users in Kenya (M-Pesa integration)
- Privacy-conscious individuals
- Users with multiple payment methods/accounts
- Anyone tracking detailed expense categories

## ✨ Features

### 📱 Core Transaction Management

- **Quick expense entry** with date, amount, category, payment method, and recipient
- **Multiple account support** with currency tracking (KES, USD, etc.)
- **Multiple payment methods per account** (e.g., M-Pesa, PayPal, Cash)
- **Smart recipient management** with usage tracking
- **Edit & delete transactions** with confirmation dialogs
- **Real-time validation** and error messages

### 💰 Account & Payment Method Management

- Create and manage multiple accounts with custom currencies
- Add multiple payment methods per account with flexible naming
- Activate/deactivate accounts and payment methods without deleting data
- View balance summaries across all payment methods

### 🏷️ Smart Categorization

- Organize expenses with buckets and categories (e.g., "Essentials > Groceries")
- Activate/deactivate categories dynamically
- Automatic category suggestions based on usage frequency
- Bucket-based filtering with category dependencies

### 👥 Recipient Tracking

- Maintain a list of frequent recipients
- Track transaction history per recipient
- Activate/deactivate recipients without losing history
- Search and sort functionality

### 📊 Transaction Filtering & Reporting

- **Advanced filtering** by account, payment method, category, recipient, and date range
- **Cascade filtering** (account → payment method, bucket → category)
- **Currency-aware display** in all dropdowns
- Smart handling of deactivated items (hidden in add mode, visible in edit mode)
- Export-ready transaction summaries

### 📱 SMS Import (M-Pesa)

- Auto-import M-Pesa transactions from SMS
- Template-based SMS parsing with regex patterns
- Auto-create recipients from transaction data
- Manual recipient editing before saving

### 🎨 User Experience

- **Mobile-responsive design** (works on phones, tablets, desktops)
- **Intuitive management pages** (Accounts, Recipients, Buckets, Categories)
- **Toast notifications** for all actions (success, error, info)
- **Dark mode support** via Ionic theme
- **Floating action buttons (FAB)** for quick access

---

## 🛠️ Tech Stack

| Layer                | Technology                         | Version  |
| -------------------- | ---------------------------------- | -------- |
| **Framework**        | React                              | 18.2+    |
| **Language**         | TypeScript                         | 5.0+     |
| **UI Library**       | Ionic Framework                    | 7.0+     |
| **Routing**          | React Router                       | 6.0+     |
| **Database**         | Dexie.js (IndexedDB wrapper)       | 4.0+     |
| **State Management** | React Hooks (useState, useContext) | Built-in |
| **Styling**          | CSS-in-JS (Ionic components)       | Native   |
| **Build Tool**       | Create React App / Vite            | Latest   |

### Database Architecture

- **Dexie.js** wraps browser's IndexedDB for offline-first storage
- **Tables:** Accounts, PaymentMethods, Recipients, Buckets, Categories, Transactions, SmsImportTemplates
- **Relationships:** Enforced via foreign keys in application logic
- **Transactions:** Atomic operations ensure data consistency
- **Indexing:** Optimized queries by date, category, account, recipient

### State Management

- **React Hooks** (useState, useEffect, useContext) for local component state
- **No Redux/MobX** - Lightweight approach for manageable complexity
- **Dexie queries** for fetching and filtering data
- **Custom hooks** for reusable logic (useIonViewWillEnter for data refresh)

---

## 🚀 Getting Started

### Prerequisites

- Node.js 16+ and npm/yarn
- Git
- Modern browser with IndexedDB support

### Installation

```bash
# Clone the repository
git clone https://github.com/Bleezapheronn/personal-finance.git
cd personal-finance

# Install dependencies
npm install
# or
yarn install
```

### Environment Setup

Create a `.env` file in the root directory:

```env
# Development
REACT_APP_ENV=development
REACT_APP_DB_NAME=personal_finance_dev

# Production
# REACT_APP_ENV=production
# REACT_APP_DB_NAME=personal_finance
```

### Development Server

```bash
# Start development server with hot reload
npm start
# or
yarn start

# Opens automatically at http://localhost:3000
```

### Production Build

```bash
# Create optimized production build
npm run build
# or
yarn build

# Output in ./build directory
# Ready to deploy to static hosting (Vercel, Netlify, GitHub Pages, etc.)

# Test production build locally
npm run serve
```

### Running Tests

```bash
# Run test suite
npm test

# Run specific test file
npm test AccountsManagement

# Run with coverage
npm test -- --coverage
```

---

## 📖 Usage Guide

### Adding a Transaction

1. Click **"Add Transaction"** from navigation
2. Select transaction type (Expense, Income, Transfer)
3. Enter date, time, and amount
4. Select payment method (account + method combo)
5. Select category from active bucket
6. Add recipient and optional description
7. Click **"ADD TRANSACTION"** → Redirects to Transactions list

### Managing Accounts

1. Go to **"Accounts"** → Click **"+"** FAB
2. Enter account name (required) and currency (required)
3. Click **"Add Account"**
4. To add payment methods: Click account to expand, click **"+"** to add method
5. Toggle checkmark to activate/deactivate (stays in records)
6. Click trash to delete (only if unused in transactions)

### Filtering Transactions

1. Go to **"Transactions"** page
2. Open **"Filters"** accordion
3. Select any combination:
   - Account → Payment Method dropdown updates automatically
   - Bucket → Category dropdown updates automatically
   - Date range
   - Recipient
4. Results update in real-time
5. Clear individual filters by clicking **"X"**

### Viewing Reports

1. Go to **"Reports"** page (future phase)
2. Select period (Daily, Weekly, Monthly, Yearly)
3. View bucket breakdowns and spending trends
4. Export to Excel/Google Sheets (planned feature)

---

## 📁 Project Structure

```
src/
├── components/           # Reusable React components
│   ├── AddAccountModal.tsx
│   ├── AddCategoryModal.tsx
│   ├── AddRecipientModal.tsx
│   └── SearchableFilterSelect.tsx
├── pages/               # Page components (routed)
│   ├── AccountsManagement.tsx
│   ├── RecipientsManagement.tsx
│   ├── BucketsManagement.tsx
│   ├── AddTransaction.tsx
│   ├── Transactions.tsx
│   └── SmsImportModal.tsx
├── db.ts               # Dexie database schema & types
├── utils/              # Utility functions
│   ├── reportService.ts
│   ├── smsParser.ts
│   └── dateHelpers.ts
└── App.tsx             # Main app component & routing
```

---

## ✅ Current Status

### Phase 2: Polish & Consistency - **COMPLETE** ✅

**What's implemented:**

- ✅ All 4 management pages (Accounts, Recipients, Buckets, Categories)
- ✅ Complete transaction CRUD with smart editing
- ✅ Advanced filtering with cascade dependencies
- ✅ Currency display in payment method dropdowns
- ✅ Smart deactivation/deletion logic (distinguishes used vs unused items)
- ✅ SMS import templates management
- ✅ Mobile-responsive design
- ✅ Comprehensive error handling and validation
- ✅ Toast notifications for all user actions
- ✅ **50+ test scenarios verified and passing**

**Key improvements from Phase 1:**

- Fixed deactivated item handling in add/edit flows
- Implemented cascade filtering (Account→PaymentMethod, Bucket→Category)
- Refactored AddCategoryModal for reuse in BucketsManagement
- Fixed bucket edit mode (no form reset on update)
- Added currency context to all payment method displays
- Improved UX consistency across all pages

### Phase 3: Future Enhancements (Roadmap)

**Planned features:**

- [ ] **Recipient Management:** Merge/deduplicate similar recipients
- [ ] **Recurring Transactions:** Schedule and track budgets
- [ ] **Advanced Reporting:** Visualize spending trends with charts
- [ ] **SMS Auto-Import:** Auto-create recipients during import
- [ ] **Budget Goals:** Set and track savings targets
- [ ] **FAB Navigation:** Quick access to Add Transaction & Budget pages
- [ ] **Cloud Sync:** Optional encrypted backup (planned)

See [To Do.md](design/docs/To%20Do.md) for detailed task breakdown.

---

## 🎯 Known Limitations & Future Improvements

| Limitation                | Impact                        | Status                           |
| ------------------------- | ----------------------------- | -------------------------------- |
| No cloud sync             | Requires manual backup        | Phase 3                          |
| M-Pesa SMS only           | Limited to Kenya market       | Extensible to other SMS patterns |
| No recurring transactions | Must enter manually each time | Phase 3                          |
| No budget alerts          | No spending limit warnings    | Phase 3                          |
| Limited analytics         | Basic reports only            | Phase 3                          |

---

## 📸 Screenshots

_Coming soon - Add screenshots of:_

- Add Transaction flow (EXPENSE tab)
- Transactions list with filtering
- Accounts management with payment methods
- Recipients management page
- Reports dashboard

---

## 🔒 Privacy & Security

- **Offline-first:** All data stored locally on device (browser IndexedDB)
- **No server communication:** No tracking, no analytics
- **No cloud backup (yet):** Future optional encrypted sync planned
- **No third-party integrations:** Fully self-contained
- **Open source:** Code transparency for security auditing

---

## 🐛 Troubleshooting

### App doesn't load

- Clear browser cache and refresh
- Check browser console (F12) for errors
- Ensure IndexedDB is enabled in browser settings

### Transactions don't filter correctly

- Clear filters and try again
- Check that bucket/account are active (not deactivated)
- Refresh page (Ctrl+R / Cmd+R)

### Payment methods not showing

- Verify parent account is active
- Check that payment method is active (toggle in Accounts)
- Reload page if just created

---

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

For bug reports, please open an Issue with:

- Description of the bug
- Steps to reproduce
- Expected vs. actual behavior
- Screenshots/console errors

---

## 📄 License

Released under the **MIT License** - See [LICENSE](LICENSE) file for details.

---

## 📚 Additional Resources

- [Development Roadmap](design/docs/Development%20Roadmap.md)
- [Data Map](design/docs/Data%20Map.md)
- [Test Plan](design/docs/Test%20Plan.md)
- [To-Do List](design/docs/To%20Do.md)
- [Dexie.js Docs](https://dexie.org/)
- [Ionic Framework Docs](https://ionicframework.com/docs)

---

<div align="center">

**Built with ❤️ for better personal finance management**

[Report Bug](https://github.com/yourusername/personal-finance/issues) · [Request Feature](https://github.com/yourusername/personal-finance/issues)

</div>
