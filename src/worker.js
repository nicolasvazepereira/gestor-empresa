const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
const fail = (message, status = 400) => reply({ error: message }, status);
const id = () => crypto.randomUUID();
const body = async request => { try { return await request.json(); } catch { throw new Error("JSON inválido"); } };
const cleanStatus = value => value === "Pago" ? "Pago" : "Pendente";

async function bootstrap(db) {
  const [inventory, sales, suppliers, goals] = await db.batch([
    db.prepare("SELECT id,name,sku,category,qty,min,cost,price FROM inventory ORDER BY created_at DESC"),
    db.prepare("SELECT id,date,customer,product,product_id,qty,total,status FROM sales ORDER BY date DESC, created_at DESC"),
    db.prepare("SELECT id,supplier,description,due,total,status FROM suppliers ORDER BY due ASC, created_at DESC"),
    db.prepare("SELECT id,title,target,current,deadline FROM goals ORDER BY deadline ASC, created_at DESC")
  ]);
  return { inventory: inventory.results, sales: sales.results, suppliers: suppliers.results, goals: goals.results };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      if (request.method === "GET" && url.pathname === "/api/health") return reply({ ok: true });
      if (request.method === "GET" && url.pathname === "/api/bootstrap") return reply(await bootstrap(env.DB));

      const parts = url.pathname.split("/").filter(Boolean);
      const area = parts[1]; const itemId = parts[2]; const action = parts[3];
      const allowed = ["inventory", "sales", "suppliers", "goals"];
      if (!allowed.includes(area)) return fail("Rota não encontrada", 404);

      if (request.method === "POST" && parts.length === 2) {
        const x = await body(request); const newId = id();
        if (area === "inventory") {
          if (!x.name || !x.sku || !x.category) return fail("Produto, SKU e categoria são obrigatórios");
          await env.DB.prepare("INSERT INTO inventory(id,name,sku,category,qty,min,cost,price) VALUES(?,?,?,?,?,?,?,?)")
            .bind(newId, x.name.trim(), x.sku.trim(), x.category.trim(), Number(x.qty), Number(x.min), Number(x.cost), Number(x.price)).run();
        } else if (area === "sales") {
          if (!x.date || !x.customer || !x.product || Number(x.qty) <= 0) return fail("Dados da venda inválidos");
          const product = await env.DB.prepare("SELECT id,qty FROM inventory WHERE name=?").bind(x.product).first();
          if (!product) return fail("Produto não encontrado", 404);
          if (Number(product.qty) < Number(x.qty)) return fail("Estoque insuficiente", 409);
          await env.DB.batch([
            env.DB.prepare("INSERT INTO sales(id,date,customer,product,product_id,qty,total,status) VALUES(?,?,?,?,?,?,?,?)")
              .bind(newId, x.date, x.customer.trim(), x.product, product.id, Number(x.qty), Number(x.total), cleanStatus(x.status)),
            env.DB.prepare("UPDATE inventory SET qty=qty-? WHERE id=? AND qty>=?").bind(Number(x.qty), product.id, Number(x.qty))
          ]);
        } else if (area === "suppliers") {
          if (!x.supplier || !x.description || !x.due) return fail("Dados do fornecedor inválidos");
          await env.DB.prepare("INSERT INTO suppliers(id,supplier,description,due,total,status) VALUES(?,?,?,?,?,?)")
            .bind(newId, x.supplier.trim(), x.description.trim(), x.due, Number(x.total), cleanStatus(x.status)).run();
        } else {
          if (!x.title || !x.deadline || Number(x.target) <= 0) return fail("Dados da meta inválidos");
          await env.DB.prepare("INSERT INTO goals(id,title,target,current,deadline) VALUES(?,?,?,?,?)")
            .bind(newId, x.title.trim(), Number(x.target), Number(x.current), x.deadline).run();
        }
        return reply({ id: newId }, 201);
      }

      if (request.method === "PATCH" && action === "toggle" && ["sales","suppliers"].includes(area)) {
        const result = await env.DB.prepare(`UPDATE ${area} SET status=CASE status WHEN 'Pago' THEN 'Pendente' ELSE 'Pago' END WHERE id=?`).bind(itemId).run();
        return result.meta.changes ? reply({ ok: true }) : fail("Registro não encontrado", 404);
      }

      if (request.method === "DELETE" && itemId) {
        if (area === "sales") {
          const sale = await env.DB.prepare("SELECT product_id,qty FROM sales WHERE id=?").bind(itemId).first();
          if (!sale) return fail("Venda não encontrada", 404);
          await env.DB.batch([
            env.DB.prepare("DELETE FROM sales WHERE id=?").bind(itemId),
            env.DB.prepare("UPDATE inventory SET qty=qty+? WHERE id=?").bind(sale.qty, sale.product_id)
          ]);
        } else {
          const result = await env.DB.prepare(`DELETE FROM ${area} WHERE id=?`).bind(itemId).run();
          if (!result.meta.changes) return fail("Registro não encontrado", 404);
        }
        return reply({ ok: true });
      }
      return fail("Método ou rota não suportada", 404);
    } catch (error) {
      console.error(error);
      const conflict = String(error.message).includes("UNIQUE constraint failed");
      return fail(conflict ? "Já existe um registro com este SKU" : "Erro interno ao processar a solicitação", conflict ? 409 : 500);
    }
  }
};
