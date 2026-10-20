import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read, makePngDataUrl, makeJpegDataUrl, createReceivingHarness } from './helpers/receiving-fake-db.mjs';

test('Routes authenticate before parsing bodies and reject anonymous requests', async (t) => {
  const routesSource = await read('../src/routes/receiving-documents.routes.js');
  const authIdx = routesSource.indexOf('router.use(authenticate)');
  const jsonIdx = routesSource.indexOf("express.json({ limit: '6mb' })");
  assert.ok(authIdx !== -1 && jsonIdx !== -1 && authIdx < jsonIdx, 'authenticate must run before 6mb json parser');

  const registeredEndpoints = [
    ['get', '/suppliers'],
    ['get', '/supplier-products'],
    ['get', '/expected'],
    ['get', '/'],
    ['post', '/'],
    ['get', '/:id'],
    ['put', '/:id'],
    ['post', '/:id/images'],
    ['get', '/:id/images/:imageId'],
    ['post', '/:id/ocr'],
    ['post', '/:id/signatures'],
    ['post', '/:id/confirm'],
    ['post', '/:id/void']
  ];
  for (const [method, path] of registeredEndpoints) {
    await t.test(`${method.toUpperCase()} ${path} is registered`, () => {
      assert.ok(
        routesSource.includes(`router.${method}('${path}'`),
        `Missing route registration: ${method.toUpperCase()} ${path}`
      );
    });
  }

  const authContext = vm.createContext({ console });
  const authModule = new vm.SourceTextModule(
    await read('../src/middleware/auth.js'),
    { context: authContext }
  );
  await authModule.link((specifier) => {
    if (specifier.endsWith('/jwt.js')) {
      return new vm.SyntheticModule(['verifyToken'], function () {
        this.setExport('verifyToken', () => {
          throw new Error('Invalid token');
        });
      }, { context: authContext });
    }
    throw new Error(`Unexpected dependency in auth.js: ${specifier}`);
  });
  await authModule.evaluate();
  const { authenticate } = authModule.namespace;
  for (const [method, path] of registeredEndpoints) {
    await t.test(`${method.toUpperCase()} ${path} rejects missing authentication with 401`, async () => {
      let statusCode = null;
      let body = null;
      let nextCalled = false;
      await authenticate(
        { method: method.toUpperCase(), path, headers: {} },
        {
          status(code) {
            statusCode = code;
            return this;
          },
          json(payload) {
            body = payload;
            return this;
          }
        },
        () => {
          nextCalled = true;
        }
      );
      assert.equal(nextCalled, false);
      assert.equal(statusCode, 401);
      assert.equal(body.success, false);
    });
  }
});

test("IDOR rejects cross-branch documents, images and linked order items", async (t) => {
  const h = await createReceivingHarness();
  const userBranch1 = { id: 12, name: 'UserBranch1', role: 'user', branch_id: 1, department_id: 10 };
  const userBranch2 = { id: 22, name: 'UserBranch2', role: 'user', branch_id: 2, department_id: 20 };
  let docId, imageId;
  await t.test("Create rejects an order item belonging to another branch", async () => {
    const crossBranchPost = await h.invoke('createDocument', {
      user: userBranch1,
      body: {
        client_uuid: 'cross-branch-post',
        delivery_date: h.today,
        kind: 'bill',
        product_group_id: 3,
        order_item_ids: [99]
      }
    });
    assert.equal(crossBranchPost.statusCode, 403);
    assert.equal(crossBranchPost.body.code, 'FORBIDDEN');
  });
  await t.test("Create and image upload succeed for the owner", async () => {
    const created = await h.invoke('createDocument', {
      user: userBranch1,
      body: {
        client_uuid: 'valid-branch1-doc',
        delivery_date: h.today,
        kind: 'bill',
        product_group_id: 3,
        order_item_ids: [50]
      }
    });
    assert.equal(created.statusCode, 201);
    docId = String(created.body.data.id);

    const imgRes = await h.invoke('uploadImage', {
      user: userBranch1,
      params: { id: docId },
      body: { page_no: 1, image_data_url: makeJpegDataUrl(400, 300) }
    });
    assert.equal(imgRes.statusCode, 201);
    imageId = String(imgRes.body.data.image_id);
  });
  await t.test("Every document and image endpoint rejects another branch", async (scope) => {
    for (const [handler, opts] of [
      ['getDocumentById', { user: userBranch2, params: { id: docId } }],
      ['updateDocument', { user: userBranch2, params: { id: docId }, body: { doc_ref: 'HACK' } }],
      ['uploadImage', { user: userBranch2, params: { id: docId }, body: { page_no: 2, image_data_url: makeJpegDataUrl() } }],
      ['getImageBinary', { user: userBranch2, params: { id: docId, imageId } }],
      ['runOcr', { user: userBranch2, params: { id: docId } }],
      ['addSignature', { user: userBranch2, params: { id: docId }, body: { role: 'receiver', image_data_url: makePngDataUrl() } }],
      ['confirmDocument', { user: userBranch2, params: { id: docId } }],
      ['voidDocument', { user: userBranch2, params: { id: docId }, body: { reason: 'hack' } }]
    ]) {
      await scope.test(`${handler} returns 403 FORBIDDEN across branches`, async () => {
        const res = await h.invoke(handler, opts);
        assert.equal(res.statusCode, 403, `Expected 403 FORBIDDEN on ${handler}`);
        assert.equal(res.body.code, 'FORBIDDEN');
      });
    }
  });
  await t.test("Edit rejects an order item belonging to another branch", async () => {
    const crossBranchPut = await h.invoke('updateDocument', {
      user: userBranch1,
      params: { id: docId },
      body: {
        lines: [
          {
            line_no: 1,
            bill_text: 'หมูสามชั้น',
            product_id: 7,
            order_item_id: 99,
            quantity_received: '5',
            unit_price: '150.00'
          }
        ]
      }
    });
    assert.equal(crossBranchPut.statusCode, 403);
    assert.equal(crossBranchPut.body.code, 'FORBIDDEN');
  });
  await t.test("Confirm rechecks order item scope and leaves the foreign order untouched", async () => {
    await h.invoke('addSignature', {
      user: userBranch1,
      params: { id: docId },
      body: { role: 'receiver', image_data_url: makePngDataUrl() }
    });
    h.state.lines[0].order_item_id = 99;
    const crossBranchConfirm = await h.invoke('confirmDocument', {
      user: userBranch1,
      params: { id: docId }
    });
    assert.equal(crossBranchConfirm.statusCode, 403);
    assert.equal(crossBranchConfirm.body.code, 'FORBIDDEN');
    assert.equal(h.state.orderItems.find((i) => i.id === 99).received_quantity, null);
  });
});

test("Expected query validates admin department against branch", async () => {
  const h = await createReceivingHarness();
  const adminAtBranch1 = { id: 1, name: 'Admin', role: 'admin', branch_id: 1, department_id: 10 };

  const badExpected = await h.invoke('getExpected', {
    user: adminAtBranch1,
    query: { date: h.today, department_id: '20' }
  });
  assert.equal(badExpected.statusCode, 422);
  assert.equal(badExpected.body.code, 'VALIDATION_FAILED');
});

test("List query validates admin department against branch", async () => {
  const h = await createReceivingHarness();
  const adminAtBranch1 = { id: 1, name: 'Admin', role: 'admin', branch_id: 1, department_id: 10 };

  const badList = await h.invoke('listDocuments', {
    user: adminAtBranch1,
    query: { date: h.today, department_id: '20' }
  });
  assert.equal(badList.statusCode, 422);
  assert.equal(badList.body.code, 'VALIDATION_FAILED');
});

test("Create validates admin department against branch", async () => {
  const h = await createReceivingHarness();
  const adminAtBranch1 = { id: 1, name: 'Admin', role: 'admin', branch_id: 1, department_id: 10 };

  const badCreate = await h.invoke('createDocument', {
    user: adminAtBranch1,
    body: {
      client_uuid: 'bad-admin-dept-only',
      delivery_date: h.today,
      kind: 'bill',
      department_id: 20
    }
  });
  assert.equal(badCreate.statusCode, 422);
  assert.equal(badCreate.body.code, 'VALIDATION_FAILED');
});
