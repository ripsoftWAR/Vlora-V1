---
name: js-stack
version: "1.0.0"
scope: global
description: "Konvensi stack React + Vite + Express + TypeScript — berlaku semua project"
---

# ⚡ JS Stack: React + Vite + Express + TypeScript

## Stack yang Dipakai
- **Frontend:** React 19, Vite, Tailwind CSS, Framer Motion
- **Backend:** Express.js (ESM), tsx untuk dev, esbuild untuk build
- **Language:** TypeScript (strict), ESM (`import/export`, bukan `require`)
- **Database:** PostgreSQL via `pg`
- **Build:** Vite (client) + esbuild (server) → output ke `dist/`

---

## Struktur Folder Umum

```
project/
├── src/              → frontend React
│   ├── components/   → komponen UI
│   ├── pages/        → halaman / routes
│   ├── hooks/        → custom hooks
│   ├── lib/          → utilities, helpers
│   └── types/        → TypeScript types/interfaces
├── server/           → backend Express
│   ├── index.ts      → entry point server
│   ├── routes/       → route handlers
│   ├── middleware/    → auth, error handling
│   └── db/           → query functions, migrations
├── public/           → static assets
├── dist/             → build output (jangan diedit manual)
└── vite.config.ts    → konfigurasi Vite
```

---

## Konvensi TypeScript

```typescript
// ✅ Selalu kasih type yang eksplisit
const getUser = async (id: string): Promise<User | null> => { ... }

// ✅ Interface untuk shape data
interface User {
  id: string;
  name: string;
  email: string;
}

// ❌ Hindari any
const data: any = ...  // → pakai unknown lalu narrow

// ✅ Error handling yang proper
try {
  const result = await someAsyncOp();
} catch (err) {
  if (err instanceof Error) {
    console.error('Gagal:', err.message);
  }
}
```

---

## Konvensi React

```tsx
// ✅ Functional component dengan props interface
interface CardProps {
  title: string;
  onClick: () => void;
}

export const Card = ({ title, onClick }: CardProps) => {
  return <div onClick={onClick}>{title}</div>;
};

// ✅ Custom hook untuk logic yang reusable
export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  // ...
  return { user, login, logout };
};

// ❌ Hindari useEffect untuk data fetching kalau bisa
// → gunakan custom hook atau React Query
```

---

## Konvensi Express (Server)

```typescript
// ✅ Route handler dengan proper typing
import { Request, Response, NextFunction } from 'express';

export const getUsers = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const users = await db.query('SELECT * FROM users');
    res.json({ success: true, data: users.rows });
  } catch (err) {
    next(err); // lempar ke error middleware
  }
};

// ✅ Error middleware selalu di paling bawah
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.message);
  res.status(500).json({ success: false, error: err.message });
});
```

---

## Naming Convention

| Hal | Convention | Contoh |
|-----|-----------|--------|
| Variable/function | camelCase | `getUserById` |
| Class/Interface/Type | PascalCase | `UserService` |
| File (komponen) | PascalCase | `UserCard.tsx` |
| File (utils/hooks) | camelCase | `useAuth.ts` |
| File (routes/server) | kebab-case | `user-routes.ts` |
| Konstanta | SCREAMING_SNAKE | `MAX_RETRY_COUNT` |
| CSS class | Tailwind utility | `flex items-center` |

---

## Environment & Config

```typescript
// ✅ Selalu pakai dotenv + validasi
import dotenv from 'dotenv';
dotenv.config();

const PORT = process.env.PORT ?? '3000';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL wajib diisi di .env');
```

---

## Aturan Penting

- Semua async operation **wajib** pakai try/catch
- Jangan hardcode value → pakai env variable atau config
- Import path selalu eksplisit: `./user-service.js` (bukan `./user-service`)
- Jangan commit `.env` — selalu ada di `.gitignore`
- `dist/` tidak perlu diedit — itu hasil build otomatis
