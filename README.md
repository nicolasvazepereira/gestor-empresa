# Gestor Empresa com Cloudflare D1

Backend do protótipo usando Cloudflare Worker, D1 e assets estáticos.

## Implantação

```bash
npm install
npx wrangler login
npx wrangler d1 create gestor-empresa-db
```

Copie o `database_id` retornado para `wrangler.jsonc` e execute:

```bash
npm run db:local
npm run dev
npm run db:remote
npm run deploy
```

## Frontend

O React atualizado usa `/api/bootstrap` e as rotas CRUD deste Worker. Gere o build da interface e copie seu conteúdo para `public/` antes de executar `npm run deploy`.

## API

- `GET /api/health`
- `GET /api/bootstrap`
- `POST /api/inventory`
- `POST /api/sales`
- `POST /api/suppliers`
- `POST /api/goals`
- `PATCH /api/sales/:id/toggle`
- `PATCH /api/suppliers/:id/toggle`
- `DELETE /api/:area/:id`

A criação e a exclusão de vendas atualizam o estoque com `DB.batch()`.
