# Cloudflare 部署

项目已经准备好 **Cloudflare Workers + D1 + R2** 的部署方式：

- `public/`：静态前端，由 Cloudflare Assets 托管。
- `worker.mjs`：`/api/*` 接口，D1 保存站点状态，R2 保存上传图片。
- `schema.sql`：D1 表结构。
- `wrangler.toml`：绑定配置。

> 这套 Worker 版与本地 `server.js` 的行为一致，但两者使用不同的数据存储。本地数据不会自动同步到 Cloudflare。

## 1. 安装依赖

```bash
npm install
```

需要 Node.js 18+。如果还没有 Cloudflare 账号，先注册并执行：

```bash
npx wrangler login
```

## 2. 创建 D1 与 R2

```bash
npx wrangler d1 create awecean
npx wrangler r2 bucket create awecean-uploads
```

把 `wrangler.toml` 里的 `database_id` 替换为 `d1 create` 输出的 ID：

```toml
[[d1_databases]]
binding = "DB"
database_name = "awecean"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

创建表：

```bash
npx wrangler d1 execute awecean --remote --file=./schema.sql
```

R2 bucket 名称如果改了，也要同步修改 `[[r2_buckets]]` 的 `bucket_name`。

## 3. 本地预览 Worker

首次本地预览也需要创建本地表：

```bash
npx wrangler d1 execute awecean --local --file=./schema.sql
npm run cf:dev
```

打开 Wrangler 输出的本地地址。第一次访问接口时，Worker 会自动写入一个站长账号、一枚邀请码和空站点。

## 4. 部署

```bash
npm run cf:deploy
```

或在 Cloudflare Dashboard 里连接 GitHub 仓库：

1. 把项目推到 GitHub。
2. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Connect to Git**。
3. 选择仓库，Build command 填 `npm install`，Deploy command 填 `npx wrangler deploy`。
4. 在 Worker 的 **Settings → Bindings** 中确认 D1 `DB` 与 R2 `BUCKET` 已绑定。
5. 在 **Settings → Domains & Routes** 绑定自定义域名。

也可以使用仓库内的 GitHub Actions：在 GitHub 仓库 Secrets 中添加 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`，推送到 `main` 即自动部署。

## 5. 数据与限制

- D1 中只有一张 `site_state` 表，保存整站 JSON 状态（便于小社区快速启动）。
- 写入使用 `version` 乐观锁；发生并发冲突会自动重试。
- 图片保存在 R2；`GET /api/media/*` 公开读取。
- 邀请码仍按 48 小时清理；对象仍按“5 天内少于 5 次敬畏”自动下架。
- 密码在 Worker 端使用 **PBKDF2-SHA256 / 50,000 次**。本地 Node 版使用 `scrypt`，两套数据独立。
- 如果未来用户量变大，建议把 JSON 状态迁移为 D1 关系表，或给写入加 Durable Object 串行化。

## 6. 首次登录

首次访问 API 时会自动写入一个站长账号与一枚邀请码。两者都不显示在页面中，请由部署者自行保管；正式上线前请修改站长密码，并处理初始邀请码。

如果 D1 里已经存在旧版状态，先执行：

```bash
npx wrangler d1 execute awecean --remote --command "DELETE FROM site_state;"
```

然后刷新一次 API，让 Worker 用新的单站长城主状态重新播种。
