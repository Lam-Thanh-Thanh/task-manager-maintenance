const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const STORAGE_KEY = "taskManagerTasks";
const CORRUPTED_STORAGE_PREFIX = STORAGE_KEY + "_corrupted_";
const MIGRATION_BACKUP_PREFIX = STORAGE_KEY + "_migration_backup_";
const STORAGE_VERSION = 2;
const DEFAULT_NOW = 1700000100000;
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
        disabled: false,
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

function createMockDate(options) {
    const NativeDate = Date;
    let nowIndex = 0;

    function getNow() {
        if (Array.isArray(options.now)) {
            const index = Math.min(nowIndex, options.now.length - 1);
            nowIndex += 1;
            return options.now[index];
        }

        return options.now === undefined ? DEFAULT_NOW : options.now;
    }

    function MockDate(value) {
        if (arguments.length === 0) {
            return new NativeDate(getNow());
        }

        return new NativeDate(value);
    }

    MockDate.now = getNow;
    MockDate.parse = NativeDate.parse;
    MockDate.UTC = NativeDate.UTC;

    return MockDate;
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

    elements.storageWarning.className = "storage-warning";
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
                const stringValue = String(value);
                storageOperations.push({ type: "set", key, value: stringValue });

                if (options.failCorruptedBackupWrite &&
                    key.startsWith(CORRUPTED_STORAGE_PREFIX)) {
                    throw new Error("Khong the tao ban sao du lieu loi");
                }

                if (options.failMigrationBackupWrite &&
                    key.startsWith(MIGRATION_BACKUP_PREFIX)) {
                    throw new Error("Khong the tao ban sao migration");
                }

                if (options.failVersion2Write &&
                    key === STORAGE_KEY &&
                    stringValue.includes('"version":2')) {
                    throw new Error("Khong the ghi version 2");
                }

                storage[key] = stringValue;
            },
            removeItem(key) {
                storageOperations.push({ type: "remove", key });

                if (options.failPrimaryRemove && key === STORAGE_KEY) {
                    throw new Error("Khong the xoa du lieu goc");
                }

                delete storage[key];
            }
        },
        Date: createMockDate(options),
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

function getKeysWithPrefix(storage, prefix) {
    return Object.keys(storage).filter(function(key) {
        return key.startsWith(prefix);
    });
}

function getCorruptedBackupKeys(storage) {
    return getKeysWithPrefix(storage, CORRUPTED_STORAGE_PREFIX);
}

function getMigrationBackupKeys(storage) {
    return getKeysWithPrefix(storage, MIGRATION_BACKUP_PREFIX);
}

function parseMainStorage(storage) {
    return JSON.parse(storage[STORAGE_KEY]);
}

function createVersion2Task(overrides = {}) {
    return Object.assign({
        id: 1700000000000,
        name: "Cong viec hop le",
        completed: false,
        createdAt: "2023-11-14T22:13:20.000Z",
        updatedAt: "2023-11-14T22:13:20.000Z"
    }, overrides);
}

function createVersion2Payload(tasks) {
    return JSON.stringify({ version: STORAGE_VERSION, tasks });
}

function assertInvalidPayloadIsQuarantined(payload) {
    const result = createContextWithPayload(payload);
    const backupKeys = getCorruptedBackupKeys(result.storage);

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
    assert.strictEqual(elements.storageWarning.hidden, true);
    assert.deepStrictEqual(storage, {});
});

test("Legacy rong duoc backup va migration sang version 2", function() {
    const payload = "[]";
    const { elements, storage } = createContextWithPayload(payload);
    const backupKeys = getMigrationBackupKeys(storage);
    const storedData = parseMainStorage(storage);

    assert.strictEqual(storedData.version, STORAGE_VERSION);
    assert.deepStrictEqual(storedData.tasks, []);
    assert.strictEqual(backupKeys.length, 1);
    assert.strictEqual(storage[backupKeys[0]], payload);
    assert.strictEqual(elements.storageWarning.hidden, false);
    assert.ok(elements.storageWarning.classList.values.includes("storage-notice-success"));
});

test("Legacy co du lieu duoc migration va bao toan noi dung thu tu", function() {
    const legacyTasks = [
        { id: 1700000000000, name: "Cong viec A", completed: false },
        { id: "legacy-b", name: " Cong viec B ", completed: true },
        { id: "legacy-c", name: "Cong viec C", completed: false }
    ];
    const payload = JSON.stringify(legacyTasks);
    const { elements, storage } = createContextWithPayload(payload);
    const storedData = parseMainStorage(storage);

    assert.strictEqual(storedData.version, STORAGE_VERSION);
    assert.deepStrictEqual(storedData.tasks.map(function(task) {
        return task.id;
    }), legacyTasks.map(function(task) {
        return task.id;
    }));
    assert.deepStrictEqual(storedData.tasks.map(function(task) {
        return task.name;
    }), legacyTasks.map(function(task) {
        return task.name;
    }));
    assert.deepStrictEqual(storedData.tasks.map(function(task) {
        return task.completed;
    }), legacyTasks.map(function(task) {
        return task.completed;
    }));
    assert.strictEqual(elements.taskList.children.length, 3);
    assert.strictEqual(elements.totalTasks.textContent, 3);
    assert.strictEqual(elements.completedTasks.textContent, 1);
    assert.strictEqual(elements.taskInput.disabled, false);
    assert.strictEqual(elements.addTaskButton.disabled, false);
    assert.strictEqual(elements.taskList.children[0].children[0].children[0].disabled, false);
    assert.strictEqual(elements.taskList.children[0].children[1].disabled, false);
});

test("Migration suy ra timestamp tu id va gan fallback tuan tu", function() {
    const legacyTasks = [
        { id: 1700000000000, name: "Timestamp ms", completed: false },
        { id: "1700000001", name: "Timestamp giay", completed: false },
        { id: "legacy-c", name: "Fallback C", completed: false },
        { id: "legacy-d", name: "Fallback D", completed: false }
    ];
    const { storage } = createContextWithPayload(JSON.stringify(legacyTasks));
    const migratedTasks = parseMainStorage(storage).tasks;

    assert.strictEqual(migratedTasks[0].createdAt, "2023-11-14T22:13:20.000Z");
    assert.strictEqual(migratedTasks[1].createdAt, "2023-11-14T22:13:21.000Z");
    assert.ok(Date.parse(migratedTasks[3].createdAt) > Date.parse(migratedTasks[2].createdAt));
    migratedTasks.forEach(function(task) {
        assert.strictEqual(task.updatedAt, task.createdAt);
    });
});

test("Metadata sau migration la ISO datetime hop le", function() {
    const legacyTasks = [
        { id: 1, name: "Fallback", completed: false },
        { id: "task-2", name: "Fallback 2", completed: true }
    ];
    const { storage } = createContextWithPayload(JSON.stringify(legacyTasks));

    parseMainStorage(storage).tasks.forEach(function(task) {
        assert.strictEqual(typeof task.createdAt, "string");
        assert.strictEqual(typeof task.updatedAt, "string");
        assert.strictEqual(Number.isNaN(Date.parse(task.createdAt)), false);
        assert.strictEqual(Number.isNaN(Date.parse(task.updatedAt)), false);
        assert.strictEqual(task.updatedAt, task.createdAt);
    });
});

test("Version 2 hop le duoc tai truc tiep khong ghi lai", function() {
    const payload = createVersion2Payload([createVersion2Task()]);
    const { elements, storage, storageOperations } = createContextWithPayload(payload);

    assert.strictEqual(storage[STORAGE_KEY], payload);
    assert.strictEqual(getMigrationBackupKeys(storage).length, 0);
    assert.strictEqual(storageOperations.some(function(operation) {
        return operation.type === "set" || operation.type === "remove";
    }), false);
    assert.strictEqual(elements.taskList.children.length, 1);
    assert.strictEqual(elements.storageWarning.hidden, true);
    assert.strictEqual(elements.taskInput.disabled, false);
    assert.strictEqual(elements.addTaskButton.disabled, false);
    assert.strictEqual(elements.taskList.children[0].children[0].children[0].disabled, false);
    assert.strictEqual(elements.taskList.children[0].children[1].disabled, false);
});

test("Migration khong chay lap va thong bao chi hien mot lan", function() {
    const firstLoad = createContextWithPayload(JSON.stringify([
        { id: 1, name: "Legacy", completed: false }
    ]));
    const backupCount = getMigrationBackupKeys(firstLoad.storage).length;
    const secondLoad = createTestContext({ initialStorage: firstLoad.storage });

    assert.strictEqual(firstLoad.elements.storageWarning.hidden, false);
    assert.strictEqual(secondLoad.elements.storageWarning.hidden, true);
    assert.strictEqual(getMigrationBackupKeys(secondLoad.storage).length, backupCount);
    assert.strictEqual(secondLoad.storageOperations.some(function(operation) {
        return operation.type === "set" || operation.type === "remove";
    }), false);
});

test("Backup duoc ghi truoc version 2", function() {
    const payload = JSON.stringify([{ id: 1, name: "Legacy", completed: false }]);
    const { storageOperations } = createContextWithPayload(payload);
    const backupIndex = storageOperations.findIndex(function(operation) {
        return operation.type === "set" && operation.key.startsWith(MIGRATION_BACKUP_PREFIX);
    });
    const version2Index = storageOperations.findIndex(function(operation) {
        return operation.type === "set" && operation.key === STORAGE_KEY;
    });

    assert.notStrictEqual(backupIndex, -1);
    assert.notStrictEqual(version2Index, -1);
    assert.ok(backupIndex < version2Index);
});

test("Backup migration chua nguyen chuoi legacy", function() {
    const payload = ' [ { "id": 1, "name": "Legacy", "completed": false } ] ';
    const { storage } = createContextWithPayload(payload);
    const backupKey = getMigrationBackupKeys(storage)[0];

    assert.strictEqual(storage[backupKey], payload);
});

test("Backup migration that bai khong ghi de legacy", function() {
    const payload = JSON.stringify([{ id: 1, name: "Legacy", completed: false }]);
    const result = createContextWithPayload(payload, { failMigrationBackupWrite: true });

    assert.strictEqual(result.storage[STORAGE_KEY], payload);
    assert.strictEqual(getMigrationBackupKeys(result.storage).length, 0);
    assert.strictEqual(result.elements.taskList.children.length, 1);
    assert.strictEqual(result.elements.storageWarning.hidden, false);
    assert.ok(result.elements.storageWarningMessage.textContent.includes("sao lưu"));

    result.elements.taskList.children[0].children[0].children[0].events.change();
    assert.strictEqual(result.storage[STORAGE_KEY], payload);
});

test("Ghi version 2 that bai giu legacy va ban sao", function() {
    const payload = JSON.stringify([{ id: 1, name: "Legacy", completed: false }]);
    const result = createContextWithPayload(payload, { failVersion2Write: true });

    assert.strictEqual(result.storage[STORAGE_KEY], payload);
    assert.strictEqual(getMigrationBackupKeys(result.storage).length, 1);
    assert.strictEqual(result.storage[getMigrationBackupKeys(result.storage)[0]], payload);
    assert.strictEqual(result.elements.taskList.children.length, 1);
    assert.strictEqual(result.elements.storageWarning.hidden, false);
    assert.ok(result.elements.storageWarningMessage.textContent.includes("Không thể hoàn tất"));
});

test("Migration that bai giu legacy va ban sao", function() {
    const payload = JSON.stringify([{ id: 1, name: "Legacy", completed: false }]);
    const result = createContextWithPayload(payload, { now: Number.NaN });

    assert.strictEqual(result.storage[STORAGE_KEY], payload);
    assert.strictEqual(getMigrationBackupKeys(result.storage).length, 1);
    assert.strictEqual(result.storage[getMigrationBackupKeys(result.storage)[0]], payload);
    assert.strictEqual(result.elements.taskList.children.length, 1);
    assert.strictEqual(result.elements.storageWarning.hidden, false);
    assert.ok(result.elements.storageWarningMessage.textContent.includes("Không thể hoàn tất"));
});

test("Version tuong lai duoc giu nguyen va khong ghi lai", function() {
    const futureTask = createVersion2Task({ futureMetadata: "giu-nguyen" });
    const payload = JSON.stringify({ version: 3, tasks: [futureTask] });
    const result = createContextWithPayload(payload);
    const checkbox = result.elements.taskList.children[0].children[0].children[0];
    const deleteButton = result.elements.taskList.children[0].children[1];

    assert.strictEqual(result.storage[STORAGE_KEY], payload);
    assert.strictEqual(getMigrationBackupKeys(result.storage).length, 0);
    assert.strictEqual(getCorruptedBackupKeys(result.storage).length, 0);
    assert.strictEqual(result.elements.taskList.children.length, 1);
    assert.strictEqual(result.elements.totalTasks.textContent, 1);
    assert.strictEqual(result.elements.completedTasks.textContent, 0);
    assert.strictEqual(result.elements.storageWarning.hidden, false);
    assert.ok(result.elements.storageWarningMessage.textContent.includes("Chế độ chỉ đọc"));
    assert.strictEqual(result.elements.closeStorageWarningButton.hidden, true);
    assert.strictEqual(result.elements.taskInput.disabled, true);
    assert.strictEqual(result.elements.addTaskButton.disabled, true);
    assert.strictEqual(checkbox.disabled, true);
    assert.strictEqual(deleteButton.disabled, true);
    assert.strictEqual(result.storageOperations.some(function(operation) {
        return operation.type === "set" || operation.type === "remove";
    }), false);

    result.elements.closeStorageWarningButton.events.click();
    assert.strictEqual(result.elements.storageWarning.hidden, false);

    result.elements.taskInput.value = "Khong duoc ghi de";
    result.elements.addTaskButton.events.click();
    checkbox.events.change();
    deleteButton.events.click();

    assert.strictEqual(result.storage[STORAGE_KEY], payload);
    assert.strictEqual(result.elements.taskList.children.length, 1);
    assert.strictEqual(result.elements.completedTasks.textContent, 0);
    assert.strictEqual(result.storageOperations.some(function(operation) {
        return operation.type === "set" || operation.type === "remove";
    }), false);
});

test("Version tuong lai co task khong doc duoc van o che do chi doc", function() {
    const payload = JSON.stringify({ version: 3, tasks: [{ future: true }] });
    const result = createContextWithPayload(payload);

    assert.strictEqual(result.storage[STORAGE_KEY], payload);
    assert.strictEqual(result.elements.taskList.children.length, 0);
    assert.strictEqual(result.elements.storageWarning.hidden, false);
    assert.ok(result.elements.storageWarningMessage.textContent.includes("Chế độ chỉ đọc"));
    assert.strictEqual(result.elements.closeStorageWarningButton.hidden, true);
    assert.strictEqual(result.elements.taskInput.disabled, true);
    assert.strictEqual(result.elements.addTaskButton.disabled, true);
});

test("Version 2 metadata khong hop le duoc cach ly boi RQ-001", function() {
    const payload = createVersion2Payload([
        createVersion2Task({ createdAt: "khong-phai-ngay" })
    ]);

    assertInvalidPayloadIsQuarantined(payload);
});

test("Toggle giu createdAt va metadata mo rong, cap nhat updatedAt", function() {
    const originalTask = createVersion2Task({ note: "giu-lai" });
    const payload = createVersion2Payload([originalTask]);
    const result = createContextWithPayload(payload, { now: 1700000200000 });

    result.elements.taskList.children[0].children[0].children[0].events.change();

    const toggledTask = parseMainStorage(result.storage).tasks[0];
    assert.strictEqual(toggledTask.id, originalTask.id);
    assert.strictEqual(toggledTask.name, originalTask.name);
    assert.strictEqual(toggledTask.completed, true);
    assert.strictEqual(toggledTask.createdAt, originalTask.createdAt);
    assert.strictEqual(toggledTask.note, "giu-lai");
    assert.ok(Date.parse(toggledTask.updatedAt) > Date.parse(originalTask.updatedAt));
});

test("saveTasks luon ghi envelope version 2", function() {
    const result = createTestContext();

    result.elements.taskInput.value = "Cong viec moi";
    result.elements.addTaskButton.events.click();

    const storedData = parseMainStorage(result.storage);
    assert.strictEqual(storedData.version, STORAGE_VERSION);
    assert.strictEqual(Array.isArray(storedData.tasks), true);
    assert.strictEqual(storedData.tasks.length, 1);
    assert.strictEqual(storedData.tasks[0].name, "Cong viec moi");
    assert.strictEqual(storedData.tasks[0].completed, false);
    assert.strictEqual(Number.isNaN(Date.parse(storedData.tasks[0].createdAt)), false);
    assert.strictEqual(storedData.tasks[0].updatedAt, storedData.tasks[0].createdAt);
});

test("JSON sai cu phap duoc cach ly", function() {
    assertInvalidPayloadIsQuarantined("{broken");
});

test("JSON object khong phai envelope bi cach ly", function() {
    assertInvalidPayloadIsQuarantined('{"id":1}');
});

test("JSON null va primitive bi cach ly", function() {
    ["null", "42", "true", '"chuoi"'].forEach(assertInvalidPayloadIsQuarantined);
});

test("Legacy chua task khong hop le bi cach ly", function() {
    [
        "[null]",
        '[{"name":"Cong viec","completed":false}]',
        '[{"id":1,"name":"   ","completed":false}]',
        '[{"id":1,"name":"Cong viec","completed":"false"}]'
    ].forEach(assertInvalidPayloadIsQuarantined);
});

test("RQ-001 tu choi id chuoi rong", function() {
    assertInvalidPayloadIsQuarantined(
        '[{"id":"   ","name":"Cong viec","completed":false}]'
    );
});

test("RQ-001 tu choi id sai kieu", function() {
    assertInvalidPayloadIsQuarantined(
        '[{"id":true,"name":"Cong viec","completed":false}]'
    );
});

test("RQ-001 tu choi task thieu name hoac completed", function() {
    assertInvalidPayloadIsQuarantined('[{"id":1,"completed":false}]');
    assertInvalidPayloadIsQuarantined('[{"id":1,"name":"Cong viec"}]');
});

test("RQ-001 tu choi name sai kieu", function() {
    assertInvalidPayloadIsQuarantined(
        '[{"id":1,"name":123,"completed":false}]'
    );
});

test("RQ-001 backup thanh cong truoc khi xoa khoa chinh", function() {
    const result = createContextWithPayload("{broken");
    const backupIndex = result.storageOperations.findIndex(function(operation) {
        return operation.type === "set" &&
            operation.key.startsWith(CORRUPTED_STORAGE_PREFIX);
    });
    const removeIndex = result.storageOperations.findIndex(function(operation) {
        return operation.type === "remove" && operation.key === STORAGE_KEY;
    });

    assert.notStrictEqual(backupIndex, -1);
    assert.notStrictEqual(removeIndex, -1);
    assert.ok(backupIndex < removeIndex);
});

test("RQ-001 giu khoa chinh khi xoa that bai sau backup", function() {
    const payload = "{broken";
    const result = createContextWithPayload(payload, { failPrimaryRemove: true });

    assert.strictEqual(result.storage[STORAGE_KEY], payload);
    assert.strictEqual(getCorruptedBackupKeys(result.storage).length, 1);
    assert.strictEqual(
        result.storage[getCorruptedBackupKeys(result.storage)[0]],
        payload
    );
    assert.ok(result.elements.storageWarningMessage.textContent.includes("chưa thể xóa"));
});

test("RQ-001 khong ghi de backup trung timestamp", function() {
    const existingBackupKey = CORRUPTED_STORAGE_PREFIX + DEFAULT_NOW;
    const result = createContextWithPayload("{broken", {
        initialStorage: {
            [existingBackupKey]: "ban sao cu"
        }
    });

    assert.strictEqual(result.storage[existingBackupKey], "ban sao cu");
    assert.strictEqual(result.storage[existingBackupKey + "_1"], "{broken");
});

test("Du lieu loi khong lam dung khoi tao ung dung", function() {
    assert.doesNotThrow(function() {
        createContextWithPayload("[null]");
    });
});

test("Backup du lieu loi that bai khong xoa khoa chinh", function() {
    const payload = "{broken";
    const result = createContextWithPayload(payload, {
        failCorruptedBackupWrite: true
    });

    assert.strictEqual(result.storage[STORAGE_KEY], payload);
    assert.strictEqual(getCorruptedBackupKeys(result.storage).length, 0);
    assert.strictEqual(result.storageOperations.some(function(operation) {
        return operation.type === "remove" && operation.key === STORAGE_KEY;
    }), false);
});

test("Loi doc localStorage khong cho phep ghi de", function() {
    const result = createTestContext({ failPrimaryRead: true });

    assert.strictEqual(result.elements.storageWarning.hidden, false);
    result.elements.taskInput.value = "Khong ghi";
    result.elements.addTaskButton.events.click();
    assert.strictEqual(Object.prototype.hasOwnProperty.call(result.storage, STORAGE_KEY), false);
});

test("Co the dong thong bao storage", function() {
    const result = createContextWithPayload("[]");

    assert.strictEqual(result.elements.storageWarning.hidden, false);
    result.elements.closeStorageWarningButton.events.click();
    assert.strictEqual(result.elements.storageWarning.hidden, true);
});

test("Hoi quy them toggle xoa ten rong va thong ke", function() {
    const result = createTestContext({ now: 1700000200000 });
    const { elements, storage, alerts } = result;

    elements.taskInput.value = "Hoc GitHub Actions";
    elements.addTaskButton.events.click();

    let storedData = parseMainStorage(storage);
    assert.strictEqual(storedData.version, STORAGE_VERSION);
    assert.strictEqual(storedData.tasks.length, 1);
    assert.strictEqual(storedData.tasks[0].name, "Hoc GitHub Actions");
    assert.strictEqual(storedData.tasks[0].completed, false);
    assert.strictEqual(elements.totalTasks.textContent, 1);
    assert.strictEqual(elements.completedTasks.textContent, 0);

    elements.taskList.children[0].children[0].children[0].events.change();
    storedData = parseMainStorage(storage);
    assert.strictEqual(storedData.tasks[0].completed, true);
    assert.strictEqual(typeof storedData.tasks[0].createdAt, "string");
    assert.strictEqual(typeof storedData.tasks[0].updatedAt, "string");
    assert.strictEqual(elements.completedTasks.textContent, 1);

    elements.taskList.children[0].children[1].events.click();
    storedData = parseMainStorage(storage);
    assert.strictEqual(storedData.version, STORAGE_VERSION);
    assert.strictEqual(storedData.tasks.length, 0);
    assert.strictEqual(elements.totalTasks.textContent, 0);
    assert.strictEqual(elements.completedTasks.textContent, 0);

    elements.taskInput.value = "   ";
    elements.addTaskButton.events.click();
    assert.strictEqual(parseMainStorage(storage).tasks.length, 0);
    assert.strictEqual(alerts.length, 1);
});

console.log(testCount + " test cases passed.");
