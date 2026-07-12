const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const STORAGE_KEY = "taskManagerTasks";
const CORRUPTED_STORAGE_PREFIX = STORAGE_KEY + "_corrupted_";
const appSource = fs.readFileSync("app.js", "utf8");

function createElement(tagName) {
    const element = {
        tagName: tagName.toUpperCase(),
        children: [],
        className: "",
        textContent: "",
        type: "",
        checked: false,
        value: "",
        hidden: false,
        events: {},
        classList: {
            values: [],
            add(name) {
                this.values.push(name);
            }
        },
        appendChild(child) {
            this.children.push(child);
            return child;
        },
        addEventListener(type, handler) {
            this.events[type] = handler;
        },
        focus() {}
    };

    let innerHTML = "";
    Object.defineProperty(element, "innerHTML", {
        get() {
            return innerHTML;
        },
        set(value) {
            innerHTML = value;

            if (value === "") {
                element.children = [];
            }
        }
    });

    return element;
}

function createTestContext(options = {}) {
    const elements = {
        taskInput: createElement("input"),
        addTaskButton: createElement("button"),
        taskList: createElement("ul"),
        totalTasks: createElement("span"),
        completedTasks: createElement("span"),
        storageWarning: createElement("section"),
        storageWarningMessage: createElement("p"),
        closeStorageWarningButton: createElement("button")
    };

    elements.storageWarning.hidden = true;

    const storage = Object.assign({}, options.initialStorage);
    const alerts = [];
    const storageOperations = [];

    const context = {
        document: {
            getElementById(id) {
                return elements[id];
            },
            createElement
        },
        localStorage: {
            getItem(key) {
                storageOperations.push({ type: "get", key });

                if (options.failPrimaryRead && key === STORAGE_KEY) {
                    throw new Error("Khong the doc localStorage");
                }

                return Object.prototype.hasOwnProperty.call(storage, key)
                    ? storage[key]
                    : null;
            },
            setItem(key, value) {
                storageOperations.push({ type: "set", key, value });

                if (options.failBackupWrite && key.startsWith(CORRUPTED_STORAGE_PREFIX)) {
                    throw new Error("Khong the tao ban sao");
                }

                storage[key] = String(value);
            },
            removeItem(key) {
                storageOperations.push({ type: "remove", key });

                if (options.failPrimaryRemove && key === STORAGE_KEY) {
                    throw new Error("Khong the xoa du lieu goc");
                }

                delete storage[key];
            }
        },
        Date: {
            now() {
                return options.now || 1001;
            }
        },
        alert(message) {
            alerts.push(message);
        }
    };

    vm.createContext(context);
    vm.runInContext(appSource, context);

    return { elements, storage, alerts, storageOperations };
}

function createContextWithPayload(payload, options = {}) {
    return createTestContext(Object.assign({}, options, {
        initialStorage: Object.assign({}, options.initialStorage, {
            [STORAGE_KEY]: payload
        })
    }));
}

function getBackupKeys(storage) {
    return Object.keys(storage).filter(function(key) {
        return key.startsWith(CORRUPTED_STORAGE_PREFIX);
    });
}

function assertInvalidPayloadIsQuarantined(payload) {
    const result = createContextWithPayload(payload);
    const backupKeys = getBackupKeys(result.storage);

    assert.strictEqual(result.elements.storageWarning.hidden, false);
    assert.strictEqual(result.elements.taskList.children.length, 0);
    assert.strictEqual(result.elements.totalTasks.textContent, 0);
    assert.strictEqual(result.elements.completedTasks.textContent, 0);
    assert.strictEqual(result.alerts.length, 0);
    assert.strictEqual(backupKeys.length, 1);
    assert.strictEqual(result.storage[backupKeys[0]], payload);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(result.storage, STORAGE_KEY), false);

    return result;
}

let testCount = 0;

function test(name, callback) {
    callback();
    testCount += 1;
    console.log("[OK] " + name);
}

test("Khong co du lieu thi khoi dong voi danh sach rong", function() {
    const { elements, storage } = createTestContext();

    assert.strictEqual(elements.taskList.children.length, 0);
    assert.strictEqual(elements.totalTasks.textContent, 0);
    assert.strictEqual(elements.completedTasks.textContent, 0);
    assert.strictEqual(elements.storageWarning.hidden, true);
    assert.deepStrictEqual(storage, {});
});

test("Mang task hop le duoc giu nguyen", function() {
    const payload = JSON.stringify([
        { id: 1, name: " Cong viec so ", completed: false },
        { id: "task-2", name: "Da hoan thanh", completed: true }
    ]);
    const { elements, storage } = createContextWithPayload(payload);

    assert.strictEqual(storage[STORAGE_KEY], payload);
    assert.strictEqual(getBackupKeys(storage).length, 0);
    assert.strictEqual(elements.taskList.children.length, 2);
    assert.strictEqual(elements.totalTasks.textContent, 2);
    assert.strictEqual(elements.completedTasks.textContent, 1);
    assert.strictEqual(elements.taskList.children[0].children[0].children[1].textContent, " Cong viec so ");
    assert.strictEqual(elements.storageWarning.hidden, true);
});

test("JSON sai cu phap duoc cach ly", function() {
    assertInvalidPayloadIsQuarantined("{broken");
});

test("JSON la object bi tu choi", function() {
    assertInvalidPayloadIsQuarantined('{"id":1}');
});

test("JSON la null bi tu choi", function() {
    assertInvalidPayloadIsQuarantined("null");
});

test("JSON primitive bi tu choi", function() {
    ["42", "true", '"chuoi"'].forEach(assertInvalidPayloadIsQuarantined);
});

test("Mang chua null bi tu choi", function() {
    assertInvalidPayloadIsQuarantined("[null]");
});

test("Task thieu id bi tu choi", function() {
    assertInvalidPayloadIsQuarantined('[{"name":"Cong viec","completed":false}]');
});

test("Task co id chuoi rong bi tu choi", function() {
    assertInvalidPayloadIsQuarantined('[{"id":"   ","name":"Cong viec","completed":false}]');
});

test("Task co id sai kieu bi tu choi", function() {
    assertInvalidPayloadIsQuarantined('[{"id":true,"name":"Cong viec","completed":false}]');
});

test("Task co name rong hoac chi co khoang trang bi tu choi", function() {
    assertInvalidPayloadIsQuarantined('[{"id":1,"name":"","completed":false}]');
    assertInvalidPayloadIsQuarantined('[{"id":1,"name":"   ","completed":false}]');
});

test("Task thieu name hoac completed bi tu choi", function() {
    assertInvalidPayloadIsQuarantined('[{"id":1,"completed":false}]');
    assertInvalidPayloadIsQuarantined('[{"id":1,"name":"Cong viec"}]');
});

test("Task co name sai kieu bi tu choi", function() {
    assertInvalidPayloadIsQuarantined('[{"id":1,"name":123,"completed":false}]');
});

test("Task co completed sai kieu bi tu choi", function() {
    assertInvalidPayloadIsQuarantined('[{"id":1,"name":"Cong viec","completed":"false"}]');
});

test("Du lieu loi khong lam dung khoi tao ung dung", function() {
    assert.doesNotThrow(function() {
        createContextWithPayload("[null]");
    });
});

test("Ban sao chua nguyen chuoi du lieu loi", function() {
    const payload = "  {broken data  ";
    const { storage } = assertInvalidPayloadIsQuarantined(payload);
    const backupKey = getBackupKeys(storage)[0];

    assert.strictEqual(storage[backupKey], payload);
});

test("Chi xoa khoa chinh sau khi tao ban sao thanh cong", function() {
    const { storageOperations } = createContextWithPayload("{broken");
    const backupWriteIndex = storageOperations.findIndex(function(operation) {
        return operation.type === "set" && operation.key.startsWith(CORRUPTED_STORAGE_PREFIX);
    });
    const primaryRemoveIndex = storageOperations.findIndex(function(operation) {
        return operation.type === "remove" && operation.key === STORAGE_KEY;
    });

    assert.notStrictEqual(backupWriteIndex, -1);
    assert.notStrictEqual(primaryRemoveIndex, -1);
    assert.ok(backupWriteIndex < primaryRemoveIndex);
});

test("Khong xoa khoa chinh khi tao ban sao that bai", function() {
    const payload = "{broken";
    const { elements, storage, storageOperations } = createContextWithPayload(payload, {
        failBackupWrite: true
    });

    assert.strictEqual(storage[STORAGE_KEY], payload);
    assert.strictEqual(getBackupKeys(storage).length, 0);
    assert.strictEqual(storageOperations.some(function(operation) {
        return operation.type === "remove" && operation.key === STORAGE_KEY;
    }), false);
    assert.strictEqual(elements.storageWarning.hidden, false);
    assert.ok(elements.storageWarningMessage.textContent.includes("chưa thể sao lưu"));
    assert.strictEqual(elements.taskList.children.length, 0);
});

test("Canh bao phan anh truong hop khong xoa duoc du lieu goc", function() {
    const payload = "{broken";
    const { elements, storage } = createContextWithPayload(payload, {
        failPrimaryRemove: true
    });

    assert.strictEqual(storage[STORAGE_KEY], payload);
    assert.strictEqual(getBackupKeys(storage).length, 1);
    assert.ok(elements.storageWarningMessage.textContent.includes("chưa thể xóa"));
});

test("Khoa backup khong ghi de ban sao cung timestamp", function() {
    const existingBackupKey = CORRUPTED_STORAGE_PREFIX + "1001";
    const { storage } = createContextWithPayload("{broken", {
        initialStorage: {
            [existingBackupKey]: "ban sao cu"
        }
    });

    assert.strictEqual(storage[existingBackupKey], "ban sao cu");
    assert.strictEqual(storage[existingBackupKey + "_1"], "{broken");
});

test("Canh bao xuat hien khi du lieu loi", function() {
    const { elements } = createContextWithPayload("false");

    assert.strictEqual(elements.storageWarning.hidden, false);
    assert.notStrictEqual(elements.storageWarningMessage.textContent, "");
});

test("Canh bao khong xuat hien khi du lieu hop le", function() {
    const { elements } = createContextWithPayload("[]");

    assert.strictEqual(elements.storageWarning.hidden, true);
    assert.strictEqual(elements.storageWarningMessage.textContent, "");
});

test("Co the dong canh bao", function() {
    const { elements } = createContextWithPayload("{broken");

    assert.strictEqual(elements.storageWarning.hidden, false);
    elements.closeStorageWarningButton.events.click();
    assert.strictEqual(elements.storageWarning.hidden, true);
});

test("Loi doc localStorage khong lam dung ung dung", function() {
    const { elements, storageOperations } = createTestContext({ failPrimaryRead: true });

    assert.strictEqual(elements.storageWarning.hidden, false);
    assert.strictEqual(elements.taskList.children.length, 0);
    assert.strictEqual(storageOperations.some(function(operation) {
        return operation.type === "set" || operation.type === "remove";
    }), false);
});

test("Hoi quy them toggle xoa validation ten rong va thong ke", function() {
    const { elements, storage, alerts } = createTestContext();

    elements.taskInput.value = "Hoc GitHub Actions";
    elements.addTaskButton.events.click();

    let savedTasks = JSON.parse(storage[STORAGE_KEY]);
    assert.strictEqual(savedTasks.length, 1);
    assert.strictEqual(savedTasks[0].name, "Hoc GitHub Actions");
    assert.strictEqual(savedTasks[0].completed, false);
    assert.strictEqual(elements.totalTasks.textContent, 1);
    assert.strictEqual(elements.completedTasks.textContent, 0);

    elements.taskList.children[0].children[0].children[0].events.change();
    savedTasks = JSON.parse(storage[STORAGE_KEY]);
    assert.strictEqual(savedTasks[0].completed, true);
    assert.strictEqual(elements.completedTasks.textContent, 1);

    elements.taskList.children[0].children[1].events.click();
    savedTasks = JSON.parse(storage[STORAGE_KEY]);
    assert.strictEqual(savedTasks.length, 0);
    assert.strictEqual(elements.totalTasks.textContent, 0);
    assert.strictEqual(elements.completedTasks.textContent, 0);

    elements.taskInput.value = "   ";
    elements.addTaskButton.events.click();
    savedTasks = storage[STORAGE_KEY] ? JSON.parse(storage[STORAGE_KEY]) : [];
    assert.strictEqual(savedTasks.length, 0);
    assert.strictEqual(alerts.length, 1);
});

console.log(testCount + " test cases passed.");
