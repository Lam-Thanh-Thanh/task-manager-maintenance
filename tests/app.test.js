const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const STORAGE_KEY = "taskManagerTasks";
const CORRUPTED_STORAGE_PREFIX = STORAGE_KEY + "_corrupted_";
const MIGRATION_BACKUP_PREFIX = STORAGE_KEY + "_migration_backup_";
const RESTORE_BACKUP_PREFIX = STORAGE_KEY + "_restore_backup_";
const STORAGE_VERSION = 2;
const BACKUP_FORMAT_VERSION = 1;
const MAX_RESTORE_FILE_SIZE = 1024 * 1024;
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
        files: [],
        disabled: false,
        hidden: false,
        href: "",
        download: "",
        clicked: false,
        events: {},
        innerHTMLWrites: [],
        attributes: {},
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
        setAttribute(name, value) {
            this.attributes[name] = String(value);
        },
        getAttribute(name) {
            return Object.prototype.hasOwnProperty.call(this.attributes, name)
                ? this.attributes[name]
                : null;
        },
        click() {
            this.clicked = true;

            if (this.events.click) {
                return this.events.click();
            }
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
            element.innerHTMLWrites.push(value);

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
        searchInput: createElement("input"),
        filterSelect: createElement("select"),
        sortSelect: createElement("select"),
        noResultsMessage: createElement("p"),
        storageWarning: createElement("section"),
        storageWarningMessage: createElement("p"),
        closeStorageWarningButton: createElement("button"),
        exportBackupButton: createElement("button"),
        restoreBackupButton: createElement("button"),
        restoreFileInput: createElement("input"),
        backupRestoreStatus: createElement("p"),
        restoreReadOnlyHint: createElement("p"),
        dataStatusToggle: createElement("button"),
        dataStatusSummary: createElement("span"),
        dataStatus: createElement("section"),
        dataStorageState: createElement("dd"),
        dataVersionState: createElement("dd"),
        dataUsageMode: createElement("dd"),
        dataProtectionState: createElement("dd"),
        dataStatusMessage: createElement("p")
    };

    elements.storageWarning.className = "storage-warning";
    elements.storageWarning.hidden = true;
    elements.filterSelect.value = "all";
    elements.sortSelect.value = "newest";
    elements.noResultsMessage.hidden = true;
    elements.restoreFileInput.hidden = true;
    elements.backupRestoreStatus.hidden = true;
    elements.restoreReadOnlyHint.hidden = true;
    elements.dataStatus.className = "data-status";
    elements.dataStatus.hidden = true;
    elements.dataStatusToggle.setAttribute("aria-controls", "dataStatus");
    elements.dataStatusToggle.setAttribute("aria-expanded", "false");

    const storage = Object.assign({}, options.initialStorage);
    const alerts = [];
    const storageOperations = [];
    const createdElements = [];
    const bodyChildren = [];
    const createdBlobs = [];
    const createdUrls = [];
    const revokedUrls = [];
    const confirmMessages = [];
    let restoreWriteFailed = false;

    function MockBlob(parts, blobOptions = {}) {
        this.parts = parts;
        this.type = blobOptions.type || "";
        this.size = parts.reduce(function(total, part) {
            return total + String(part).length;
        }, 0);
        createdBlobs.push(this);
    }

    MockBlob.prototype.text = function() {
        return Promise.resolve(this.parts.map(String).join(""));
    };

    const context = {
        document: {
            getElementById(id) {
                return elements[id];
            },
            createElement(tagName) {
                const element = createElement(tagName);
                createdElements.push(element);
                return element;
            },
            body: {
                appendChild(element) {
                    bodyChildren.push(element);
                    element.parentNode = this;
                    return element;
                },
                removeChild(element) {
                    const index = bodyChildren.indexOf(element);

                    if (index === -1) {
                        throw new Error("Element khong nam trong body");
                    }

                    bodyChildren.splice(index, 1);
                    element.parentNode = null;
                    return element;
                }
            }
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

                if (options.failRestoreBackupWrite &&
                    key.startsWith(RESTORE_BACKUP_PREFIX)) {
                    throw new Error("Khong the tao ban sao restore");
                }

                if (options.failRestoreDataWrite &&
                    key === STORAGE_KEY &&
                    !restoreWriteFailed) {
                    restoreWriteFailed = true;
                    throw new Error("Khong the ghi du lieu restore");
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
        Blob: MockBlob,
        URL: {
            createObjectURL(blob) {
                const url = "blob:test-" + (createdUrls.length + 1);
                createdUrls.push({ url, blob });
                return url;
            },
            revokeObjectURL(url) {
                revokedUrls.push(url);
            }
        },
        Date: createMockDate(options),
        alert(message) {
            alerts.push(message);
        },
        confirm(message) {
            confirmMessages.push(message);

            if (Array.isArray(options.confirmResults)) {
                return options.confirmResults.shift();
            }

            return options.confirmResult === undefined ? true : options.confirmResult;
        }
    };

    vm.createContext(context);
    vm.runInContext(appSource, context);

    return {
        elements,
        storage,
        alerts,
        storageOperations,
        createdElements,
        bodyChildren,
        createdBlobs,
        createdUrls,
        revokedUrls,
        confirmMessages
    };
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

function getRestoreBackupKeys(storage) {
    return getKeysWithPrefix(storage, RESTORE_BACKUP_PREFIX);
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

function createBackupFileContent(tasks, overrides = {}) {
    return JSON.stringify(Object.assign({
        backupFormatVersion: BACKUP_FORMAT_VERSION,
        exportedAt: "2023-11-14T22:13:20.000Z",
        data: {
            version: STORAGE_VERSION,
            tasks
        }
    }, overrides));
}

function createRestoreFile(content, overrides = {}) {
    return Object.assign({
        name: "task-manager-backup.json",
        type: "application/json",
        size: Buffer.byteLength(content, "utf8"),
        text() {
            return Promise.resolve(content);
        }
    }, overrides);
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

const testCases = [];

function test(name, callback) {
    testCases.push({ name, callback });
}

async function runTests() {
    for (const testCase of testCases) {
        await testCase.callback();
        console.log("[OK] " + testCase.name);
    }

    console.log(testCases.length + " test cases passed.");
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

async function selectRestoreFile(result, file) {
    result.elements.restoreFileInput.files = [file];
    await result.elements.restoreFileInput.events.change({
        target: result.elements.restoreFileInput
    });
}

test("RQ-004 export dung cau truc va khong thay doi du lieu", async function() {
    const currentTask = createVersion2Task();
    const payload = createVersion2Payload([currentTask]);
    const result = createContextWithPayload(payload);
    const mutationsBefore = result.storageOperations.filter(function(operation) {
        return operation.type === "set" || operation.type === "remove";
    }).length;

    result.elements.exportBackupButton.events.click();

    assert.strictEqual(result.storage[STORAGE_KEY], payload);
    assert.strictEqual(result.storageOperations.filter(function(operation) {
        return operation.type === "set" || operation.type === "remove";
    }).length, mutationsBefore);
    assert.strictEqual(result.createdBlobs.length, 1);
    assert.strictEqual(result.createdBlobs[0].type, "application/json");

    const backupData = JSON.parse(await result.createdBlobs[0].text());
    assert.strictEqual(backupData.backupFormatVersion, BACKUP_FORMAT_VERSION);
    assert.strictEqual(backupData.exportedAt, "2023-11-14T22:15:00.000Z");
    assert.deepStrictEqual(backupData.data, {
        version: STORAGE_VERSION,
        tasks: [currentTask]
    });
});

test("RQ-004 ten file export va object URL hop le", function() {
    const result = createContextWithPayload(createVersion2Payload([
        createVersion2Task()
    ]));

    result.elements.exportBackupButton.events.click();

    const downloadLink = result.createdElements.find(function(element) {
        return element.tagName === "A";
    });
    assert.ok(downloadLink);
    assert.strictEqual(
        downloadLink.download,
        "task-manager-backup-2023-11-14-221500.json"
    );
    assert.strictEqual(downloadLink.clicked, true);
    assert.strictEqual(result.createdUrls.length, 1);
    assert.deepStrictEqual(result.revokedUrls, [result.createdUrls[0].url]);
    assert.strictEqual(result.bodyChildren.length, 0);
});

test("RQ-004 restore file hop le cap nhat storage danh sach va thong ke", async function() {
    const oldPayload = createVersion2Payload([
        createVersion2Task({ id: "old", name: "Cu" })
    ]);
    const restoredTasks = [
        createVersion2Task({ id: "new-1", name: "Moi 1" }),
        createVersion2Task({
            id: "new-2",
            name: "Moi 2",
            completed: true,
            updatedAt: "2023-11-14T22:14:20.000Z"
        })
    ];
    const fileContent = createBackupFileContent(restoredTasks);
    const file = createRestoreFile(fileContent, { name: "du-lieu-hop-le.json" });
    const result = createContextWithPayload(oldPayload);

    await selectRestoreFile(result, file);

    assert.deepStrictEqual(parseMainStorage(result.storage), {
        version: STORAGE_VERSION,
        tasks: restoredTasks
    });
    assert.strictEqual(getRestoreBackupKeys(result.storage).length, 1);
    assert.strictEqual(
        result.storage[getRestoreBackupKeys(result.storage)[0]],
        oldPayload
    );
    assert.strictEqual(result.elements.taskList.children.length, 2);
    assert.strictEqual(result.elements.totalTasks.textContent, 2);
    assert.strictEqual(result.elements.completedTasks.textContent, 1);
    assert.strictEqual(result.confirmMessages.length, 1);
    assert.ok(result.confirmMessages[0].includes("du-lieu-hop-le.json"));
    assert.ok(result.confirmMessages[0].includes("2023-11-14T22:13:20.000Z"));
    assert.ok(result.confirmMessages[0].includes("Số công việc: 2"));
    assert.ok(result.elements.backupRestoreStatus.textContent.includes("Khôi phục thành công"));
});

test("RQ-004 restore thanh cong khoi phuc kha nang luu du lieu", async function() {
    const legacyPayload = JSON.stringify([
        { id: 1, name: "Legacy", completed: false }
    ]);
    const result = createContextWithPayload(legacyPayload, {
        failMigrationBackupWrite: true,
        now: 1700000200000
    });
    const restoredTask = createVersion2Task({ id: "restored" });

    await selectRestoreFile(result, createRestoreFile(
        createBackupFileContent([restoredTask])
    ));
    result.elements.taskList.children[0].children[0].children[0].events.change();

    assert.strictEqual(parseMainStorage(result.storage).tasks[0].completed, true);
});

test("RQ-004 backup hien tai hoan thanh truoc khi ghi restore", async function() {
    const oldPayload = createVersion2Payload([createVersion2Task({ id: "old" })]);
    const file = createRestoreFile(createBackupFileContent([
        createVersion2Task({ id: "new" })
    ]));
    const result = createContextWithPayload(oldPayload);

    await selectRestoreFile(result, file);

    const backupIndex = result.storageOperations.findIndex(function(operation) {
        return operation.type === "set" &&
            operation.key.startsWith(RESTORE_BACKUP_PREFIX);
    });
    const restoreIndex = result.storageOperations.findIndex(function(operation) {
        return operation.type === "set" && operation.key === STORAGE_KEY;
    });
    assert.notStrictEqual(backupIndex, -1);
    assert.notStrictEqual(restoreIndex, -1);
    assert.ok(backupIndex < restoreIndex);
});

test("RQ-004 tu choi JSON schema backup version va data version sai", async function() {
    const currentPayload = createVersion2Payload([createVersion2Task()]);
    const invalidContents = [
        "{broken",
        JSON.stringify({ backupFormatVersion: 1, exportedAt: "bad", data: {} }),
        createBackupFileContent([], { backupFormatVersion: 2 }),
        createBackupFileContent([], { data: { version: 3, tasks: [] } }),
        createBackupFileContent([null])
    ];

    for (const content of invalidContents) {
        const result = createContextWithPayload(currentPayload);
        await selectRestoreFile(result, createRestoreFile(content));

        assert.strictEqual(result.storage[STORAGE_KEY], currentPayload);
        assert.strictEqual(getRestoreBackupKeys(result.storage).length, 0);
        assert.strictEqual(result.confirmMessages.length, 0);
        assert.strictEqual(result.elements.backupRestoreStatus.hidden, false);
        assert.ok(result.elements.backupRestoreStatus.className.includes("error"));
    }
});

test("RQ-004 chi chap nhan file JSON", async function() {
    const currentPayload = createVersion2Payload([createVersion2Task()]);
    const result = createContextWithPayload(currentPayload);
    const file = createRestoreFile(createBackupFileContent([]), {
        name: "backup.txt",
        type: "text/plain"
    });

    await selectRestoreFile(result, file);

    assert.strictEqual(result.storage[STORAGE_KEY], currentPayload);
    assert.strictEqual(result.confirmMessages.length, 0);
    assert.ok(result.elements.backupRestoreStatus.textContent.includes("file JSON"));
});

test("RQ-004 tu choi file rong va qua 1 MB", async function() {
    const currentPayload = createVersion2Payload([createVersion2Task()]);
    const emptyResult = createContextWithPayload(currentPayload);
    await selectRestoreFile(emptyResult, createRestoreFile("", { size: 0 }));
    assert.strictEqual(emptyResult.storage[STORAGE_KEY], currentPayload);
    assert.ok(emptyResult.elements.backupRestoreStatus.textContent.includes("rỗng"));

    const largeResult = createContextWithPayload(currentPayload);
    await selectRestoreFile(largeResult, createRestoreFile("{}", {
        size: MAX_RESTORE_FILE_SIZE + 1
    }));
    assert.strictEqual(largeResult.storage[STORAGE_KEY], currentPayload);
    assert.ok(largeResult.elements.backupRestoreStatus.textContent.includes("1 MB"));
});

test("RQ-004 huy xac nhan khong thay doi du lieu", async function() {
    const currentPayload = createVersion2Payload([createVersion2Task({ id: "old" })]);
    const result = createContextWithPayload(currentPayload, { confirmResult: false });
    const file = createRestoreFile(createBackupFileContent([
        createVersion2Task({ id: "new" })
    ]));

    await selectRestoreFile(result, file);

    assert.strictEqual(result.storage[STORAGE_KEY], currentPayload);
    assert.strictEqual(getRestoreBackupKeys(result.storage).length, 0);
    assert.strictEqual(result.elements.taskList.children.length, 1);
    assert.ok(result.elements.backupRestoreStatus.textContent.includes("Đã hủy"));
});

test("RQ-004 backup restore that bai khong lam mat du lieu", async function() {
    const currentPayload = createVersion2Payload([createVersion2Task({ id: "old" })]);
    const result = createContextWithPayload(currentPayload, {
        failRestoreBackupWrite: true
    });
    const file = createRestoreFile(createBackupFileContent([
        createVersion2Task({ id: "new" })
    ]));

    await selectRestoreFile(result, file);

    assert.strictEqual(result.storage[STORAGE_KEY], currentPayload);
    assert.strictEqual(getRestoreBackupKeys(result.storage).length, 0);
    assert.strictEqual(result.elements.taskList.children.length, 1);
    assert.ok(result.elements.backupRestoreStatus.textContent.includes("chưa bị thay đổi"));
});

test("RQ-004 ghi du lieu restore that bai giu du lieu hien tai", async function() {
    const currentPayload = createVersion2Payload([createVersion2Task({ id: "old" })]);
    const result = createContextWithPayload(currentPayload, {
        failRestoreDataWrite: true
    });
    const file = createRestoreFile(createBackupFileContent([
        createVersion2Task({ id: "new" })
    ]));

    await selectRestoreFile(result, file);

    assert.strictEqual(result.storage[STORAGE_KEY], currentPayload);
    assert.strictEqual(getRestoreBackupKeys(result.storage).length, 1);
    assert.strictEqual(result.elements.taskList.children.length, 1);
    assert.ok(result.elements.backupRestoreStatus.textContent.includes("vẫn được giữ nguyên"));
});

test("RQ-004 khong ghi de restore backup trung timestamp", async function() {
    const currentPayload = createVersion2Payload([createVersion2Task({ id: "old" })]);
    const existingBackupKey = RESTORE_BACKUP_PREFIX + DEFAULT_NOW;
    const result = createContextWithPayload(currentPayload, {
        initialStorage: {
            [existingBackupKey]: "ban sao restore cu"
        }
    });
    const file = createRestoreFile(createBackupFileContent([
        createVersion2Task({ id: "new" })
    ]));

    await selectRestoreFile(result, file);

    assert.strictEqual(result.storage[existingBackupKey], "ban sao restore cu");
    assert.strictEqual(result.storage[existingBackupKey + "_1"], currentPayload);
});

test("RQ-004 che do chi doc cho export nhung chan restore", async function() {
    const futureTask = createVersion2Task({ futureMetadata: "giu-nguyen" });
    const futurePayload = JSON.stringify({ version: 3, tasks: [futureTask] });
    const result = createContextWithPayload(futurePayload);

    assert.strictEqual(result.elements.exportBackupButton.disabled, false);
    assert.strictEqual(result.elements.restoreBackupButton.disabled, true);
    assert.strictEqual(result.elements.restoreFileInput.disabled, true);
    assert.strictEqual(result.elements.restoreReadOnlyHint.hidden, false);
    assert.ok(result.elements.restoreReadOnlyHint.textContent.includes("Chế độ chỉ đọc"));

    result.elements.exportBackupButton.events.click();
    assert.strictEqual(result.createdBlobs.length, 1);
    const exportedBackup = JSON.parse(await result.createdBlobs[0].text());
    assert.strictEqual(exportedBackup.data.version, STORAGE_VERSION);
    assert.strictEqual(exportedBackup.data.tasks.length, 1);

    result.elements.restoreBackupButton.events.click();
    assert.strictEqual(result.elements.restoreFileInput.clicked, false);

    await selectRestoreFile(result, createRestoreFile(createBackupFileContent([])));
    assert.strictEqual(result.storage[STORAGE_KEY], futurePayload);
    assert.strictEqual(getRestoreBackupKeys(result.storage).length, 0);
    assert.strictEqual(result.confirmMessages.length, 0);
    assert.ok(result.elements.backupRestoreStatus.textContent.includes("Chế độ chỉ đọc"));
});

function createAdvancedTasks() {
    return [
        createVersion2Task({
            id: "alpha",
            name: "Alpha",
            completed: false,
            createdAt: "2023-11-14T10:00:00.000Z",
            updatedAt: "2023-11-14T10:00:00.000Z"
        }),
        createVersion2Task({
            id: "bravo",
            name: "bravo",
            completed: true,
            createdAt: "2023-11-14T12:00:00.000Z",
            updatedAt: "2023-11-14T12:00:00.000Z"
        }),
        createVersion2Task({
            id: "charlie",
            name: "Charlie",
            completed: false,
            createdAt: "2023-11-14T11:00:00.000Z",
            updatedAt: "2023-11-14T11:00:00.000Z"
        })
    ];
}

function getRenderedTaskNames(elements) {
    return elements.taskList.children.map(function(taskItem) {
        const nameElement = taskItem.children[0].children[1];
        return nameElement.tagName === "INPUT"
            ? nameElement.value
            : nameElement.textContent;
    });
}

function findRenderedTaskItem(elements, taskName) {
    return elements.taskList.children.find(function(taskItem) {
        const nameElement = taskItem.children[0].children[1];
        const renderedName = nameElement.tagName === "INPUT"
            ? nameElement.value
            : nameElement.textContent;
        return renderedName === taskName;
    });
}

test("RQ-003 mo sua va luu ten task", function() {
    const task = createVersion2Task({ id: "edit-1", name: "Ten cu" });
    const result = createContextWithPayload(createVersion2Payload([task]), {
        now: 1700001000000
    });

    result.elements.taskList.children[0].children[2].events.click();
    const editInput = result.elements.taskList.children[0].children[0].children[1];
    assert.strictEqual(editInput.className, "edit-task-input");
    assert.strictEqual(editInput.value, "Ten cu");

    editInput.value = "  Ten moi  ";
    result.elements.taskList.children[0].children[1].events.click();

    assert.strictEqual(parseMainStorage(result.storage).tasks[0].name, "Ten moi");
    assert.deepStrictEqual(getRenderedTaskNames(result.elements), ["Ten moi"]);
});

test("RQ-003 huy sua khong thay doi du lieu", function() {
    const payload = createVersion2Payload([
        createVersion2Task({ id: "edit-cancel", name: "Giu nguyen" })
    ]);
    const result = createContextWithPayload(payload);

    result.elements.taskList.children[0].children[2].events.click();
    result.elements.taskList.children[0].children[0].children[1].value = "Khong luu";
    result.elements.taskList.children[0].children[2].events.click();

    assert.strictEqual(result.storage[STORAGE_KEY], payload);
    assert.deepStrictEqual(getRenderedTaskNames(result.elements), ["Giu nguyen"]);
});

test("RQ-003 tu choi ten sua rong", function() {
    const payload = createVersion2Payload([
        createVersion2Task({ id: "edit-empty", name: "Hop le" })
    ]);
    const result = createContextWithPayload(payload);

    result.elements.taskList.children[0].children[2].events.click();
    const editInput = result.elements.taskList.children[0].children[0].children[1];
    editInput.value = "   ";
    result.elements.taskList.children[0].children[1].events.click();

    assert.strictEqual(result.storage[STORAGE_KEY], payload);
    assert.strictEqual(result.alerts.length, 1);
    assert.strictEqual(
        result.elements.taskList.children[0].children[0].children[1].className,
        "edit-task-input"
    );
});

test("RQ-003 sua giu createdAt metadata va cap nhat updatedAt", function() {
    const originalTask = createVersion2Task({
        id: "metadata",
        name: "Metadata cu",
        note: "giu-lai"
    });
    const result = createContextWithPayload(createVersion2Payload([originalTask]), {
        now: 1700001000000
    });

    result.elements.taskList.children[0].children[2].events.click();
    result.elements.taskList.children[0].children[0].children[1].value = "Metadata moi";
    result.elements.taskList.children[0].children[1].events.click();

    const editedTask = parseMainStorage(result.storage).tasks[0];
    assert.strictEqual(editedTask.createdAt, originalTask.createdAt);
    assert.strictEqual(editedTask.note, "giu-lai");
    assert.ok(Date.parse(editedTask.updatedAt) > Date.parse(originalTask.updatedAt));
});

test("RQ-003 chi sua mot task va thoat an toan khi bi an", function() {
    const result = createContextWithPayload(createVersion2Payload(createAdvancedTasks()));

    findRenderedTaskItem(result.elements, "Alpha").children[2].events.click();
    findRenderedTaskItem(result.elements, "bravo").children[2].events.click();

    const editInputs = result.elements.taskList.children.filter(function(taskItem) {
        return taskItem.children[0].children[1].className === "edit-task-input";
    });
    assert.strictEqual(editInputs.length, 1);
    assert.strictEqual(editInputs[0].children[0].children[1].value, "bravo");

    result.elements.searchInput.value = "Alpha";
    result.elements.searchInput.events.input();
    result.elements.searchInput.value = "";
    result.elements.searchInput.events.input();

    assert.strictEqual(
        result.elements.taskList.children.some(function(taskItem) {
            return taskItem.children[0].children[1].className === "edit-task-input";
        }),
        false
    );
});

test("RQ-003 search khong phan biet hoa thuong va tu khoa rong", function() {
    const result = createContextWithPayload(createVersion2Payload(createAdvancedTasks()));

    result.elements.searchInput.value = "BRAVO";
    result.elements.searchInput.events.input();
    assert.deepStrictEqual(getRenderedTaskNames(result.elements), ["bravo"]);

    result.elements.searchInput.value = "   ";
    result.elements.searchInput.events.input();
    assert.deepStrictEqual(getRenderedTaskNames(result.elements), [
        "bravo",
        "Charlie",
        "Alpha"
    ]);
});

test("RQ-003 ba bo loc hoat dong", function() {
    const result = createContextWithPayload(createVersion2Payload(createAdvancedTasks()));

    result.elements.filterSelect.value = "pending";
    result.elements.filterSelect.events.change();
    assert.deepStrictEqual(getRenderedTaskNames(result.elements), ["Charlie", "Alpha"]);

    result.elements.filterSelect.value = "completed";
    result.elements.filterSelect.events.change();
    assert.deepStrictEqual(getRenderedTaskNames(result.elements), ["bravo"]);

    result.elements.filterSelect.value = "all";
    result.elements.filterSelect.events.change();
    assert.strictEqual(result.elements.taskList.children.length, 3);
});

test("RQ-003 bon kieu sap xep hoat dong", function() {
    const result = createContextWithPayload(createVersion2Payload(createAdvancedTasks()));
    const expectations = {
        newest: ["bravo", "Charlie", "Alpha"],
        oldest: ["Alpha", "Charlie", "bravo"],
        "name-asc": ["Alpha", "bravo", "Charlie"],
        "name-desc": ["Charlie", "bravo", "Alpha"]
    };

    Object.keys(expectations).forEach(function(sortValue) {
        result.elements.sortSelect.value = sortValue;
        result.elements.sortSelect.events.change();
        assert.deepStrictEqual(
            getRenderedTaskNames(result.elements),
            expectations[sortValue]
        );
    });
});

test("RQ-003 ket hop search filter sort", function() {
    const result = createContextWithPayload(createVersion2Payload(createAdvancedTasks()));

    result.elements.searchInput.value = "a";
    result.elements.searchInput.events.input();
    result.elements.filterSelect.value = "pending";
    result.elements.filterSelect.events.change();
    result.elements.sortSelect.value = "name-desc";
    result.elements.sortSelect.events.change();

    assert.deepStrictEqual(getRenderedTaskNames(result.elements), ["Charlie", "Alpha"]);
});

test("RQ-003 thay doi view khong doi storage hoac thu tu goc", async function() {
    const originalTasks = createAdvancedTasks();
    const payload = createVersion2Payload(originalTasks);
    const result = createContextWithPayload(payload);
    const mutationsBefore = result.storageOperations.filter(function(operation) {
        return operation.type === "set" || operation.type === "remove";
    }).length;

    result.elements.searchInput.value = "a";
    result.elements.searchInput.events.input();
    result.elements.filterSelect.value = "pending";
    result.elements.filterSelect.events.change();
    result.elements.sortSelect.value = "name-desc";
    result.elements.sortSelect.events.change();

    assert.strictEqual(result.storage[STORAGE_KEY], payload);
    assert.strictEqual(result.storageOperations.filter(function(operation) {
        return operation.type === "set" || operation.type === "remove";
    }).length, mutationsBefore);

    result.elements.exportBackupButton.events.click();
    const exportedBackup = JSON.parse(await result.createdBlobs[0].text());
    assert.deepStrictEqual(exportedBackup.data.tasks.map(function(task) {
        return task.id;
    }), originalTasks.map(function(task) {
        return task.id;
    }));
});

test("RQ-003 thong ke dua tren toan bo tasks", function() {
    const result = createContextWithPayload(createVersion2Payload(createAdvancedTasks()));

    result.elements.filterSelect.value = "completed";
    result.elements.filterSelect.events.change();

    assert.strictEqual(result.elements.taskList.children.length, 1);
    assert.strictEqual(result.elements.totalTasks.textContent, 3);
    assert.strictEqual(result.elements.completedTasks.textContent, 1);
});

test("RQ-003 hien thong bao khi khong co ket qua", function() {
    const result = createContextWithPayload(createVersion2Payload(createAdvancedTasks()));

    result.elements.searchInput.value = "khong-ton-tai";
    result.elements.searchInput.events.input();

    assert.strictEqual(result.elements.taskList.children.length, 0);
    assert.strictEqual(result.elements.noResultsMessage.hidden, false);
    assert.ok(result.elements.noResultsMessage.textContent.includes("Không tìm thấy"));
});

test("RQ-003 read-only cho xem nhung chan sua du lieu", function() {
    const futureTasks = createAdvancedTasks();
    const futurePayload = JSON.stringify({ version: 3, tasks: futureTasks });
    const result = createContextWithPayload(futurePayload);

    assert.strictEqual(result.elements.searchInput.disabled, false);
    assert.strictEqual(result.elements.filterSelect.disabled, false);
    assert.strictEqual(result.elements.sortSelect.disabled, false);

    result.elements.searchInput.value = "Alpha";
    result.elements.searchInput.events.input();
    assert.deepStrictEqual(getRenderedTaskNames(result.elements), ["Alpha"]);

    const taskItem = result.elements.taskList.children[0];
    const checkbox = taskItem.children[0].children[0];
    const deleteButton = taskItem.children[1];
    const editButton = taskItem.children[2];
    assert.strictEqual(checkbox.disabled, true);
    assert.strictEqual(deleteButton.disabled, true);
    assert.strictEqual(editButton.disabled, true);

    checkbox.events.change();
    deleteButton.events.click();
    editButton.events.click();
    assert.strictEqual(result.storage[STORAGE_KEY], futurePayload);
    assert.deepStrictEqual(getRenderedTaskNames(result.elements), ["Alpha"]);
    assert.strictEqual(result.elements.taskList.children[0].children.length, 3);
});

test("RQ-003 export backup chua ten sau khi sua", async function() {
    const result = createContextWithPayload(createVersion2Payload([
        createVersion2Task({ id: "export-edited", name: "Truoc khi sua" })
    ]), { now: 1700001000000 });

    result.elements.taskList.children[0].children[2].events.click();
    result.elements.taskList.children[0].children[0].children[1].value = "Sau khi sua";
    result.elements.taskList.children[0].children[1].events.click();
    result.elements.exportBackupButton.events.click();

    const exportedBackup = JSON.parse(await result.createdBlobs[0].text());
    assert.strictEqual(exportedBackup.data.tasks[0].name, "Sau khi sua");
});

test("Trang thai du lieu binh thuong khong bi anh huong boi backup cu", function() {
    const initialStorage = {};
    initialStorage[STORAGE_KEY] = createVersion2Payload([createVersion2Task()]);
    initialStorage[MIGRATION_BACKUP_PREFIX + "old"] = "[]";

    const result = createTestContext({ initialStorage });

    assert.ok(result.elements.dataStatus.className.includes("data-status-normal"));
    assert.strictEqual(result.elements.dataStorageState.textContent, "Hoạt động bình thường");
    assert.strictEqual(result.elements.dataVersionState.textContent, "Version 2");
    assert.strictEqual(result.elements.dataUsageMode.textContent, "Đọc và ghi");
    assert.strictEqual(
        result.elements.dataProtectionState.textContent,
        "Không tạo bản sao trong lần tải này"
    );
});

test("Trang thai hien thi du lieu loi da duoc cach ly", function() {
    const result = createContextWithPayload("{broken", { now: DEFAULT_NOW });

    assert.ok(result.elements.dataStatus.className.includes("data-status-quarantined"));
    assert.strictEqual(
        result.elements.dataStorageState.textContent,
        "Dữ liệu lỗi đã được cách ly"
    );
    assert.strictEqual(result.elements.dataVersionState.textContent, "Version 2");
    assert.strictEqual(result.elements.dataUsageMode.textContent, "Đọc và ghi");
    assert.strictEqual(
        result.elements.dataProtectionState.textContent,
        "Đã tạo bản sao dữ liệu lỗi"
    );
});

test("Trang thai hien thi migration thanh cong trong lan tai hien tai", function() {
    const legacyTasks = [{
        id: 1700000000000,
        name: "Du lieu cu",
        completed: false
    }];
    const result = createContextWithPayload(JSON.stringify(legacyTasks));

    assert.ok(result.elements.dataStatus.className.includes("data-status-migrated"));
    assert.strictEqual(
        result.elements.dataStorageState.textContent,
        "Đã chuyển đổi dữ liệu cũ"
    );
    assert.strictEqual(result.elements.dataVersionState.textContent, "Version 2");
    assert.strictEqual(result.elements.dataUsageMode.textContent, "Đọc và ghi");
    assert.strictEqual(
        result.elements.dataProtectionState.textContent,
        "Đã tạo bản sao trước chuyển đổi"
    );
});

test("Trang thai hien thi version tuong lai va che do chi doc", function() {
    const futureVersion = 7;
    const futurePayload = JSON.stringify({
        version: futureVersion,
        tasks: [createVersion2Task()]
    });
    const result = createContextWithPayload(futurePayload);

    assert.ok(result.elements.dataStatus.className.includes("data-status-readonly"));
    assert.strictEqual(
        result.elements.dataStorageState.textContent,
        "Phiên bản chưa tương thích"
    );
    assert.strictEqual(result.elements.dataVersionState.textContent, "Version 7");
    assert.strictEqual(result.elements.dataUsageMode.textContent, "Chỉ đọc");
    assert.strictEqual(result.elements.taskInput.disabled, true);
    assert.strictEqual(result.elements.addTaskButton.disabled, true);
    assert.strictEqual(result.elements.restoreBackupButton.disabled, true);
    assert.strictEqual(result.storage[STORAGE_KEY], futurePayload);
});

test("Trang thai khong dung innerHTML hoac hien thi du lieu nguoi dung", function() {
    const userContent = '<img src=x onerror="alert(1)">';
    const result = createContextWithPayload(createVersion2Payload([
        createVersion2Task({ name: userContent })
    ]));
    const statusElements = [
        result.elements.dataStatusToggle,
        result.elements.dataStatusSummary,
        result.elements.dataStatus,
        result.elements.dataStorageState,
        result.elements.dataVersionState,
        result.elements.dataUsageMode,
        result.elements.dataProtectionState,
        result.elements.dataStatusMessage
    ];
    const displayedStatus = statusElements.map(function(element) {
        return element.textContent;
    }).join(" ");

    statusElements.forEach(function(element) {
        assert.strictEqual(element.innerHTMLWrites.length, 0);
    });
    assert.strictEqual(displayedStatus.includes(userContent), false);
    assert.deepStrictEqual(getRenderedTaskNames(result.elements), [userContent]);
});

test("Nut trang thai binh thuong thu gon mac dinh", function() {
    const result = createContextWithPayload(createVersion2Payload([createVersion2Task()]));

    assert.strictEqual(result.elements.dataStatusSummary.textContent, "● Dữ liệu bình thường");
    assert.strictEqual(result.elements.dataStatus.hidden, true);
    assert.strictEqual(
        result.elements.dataStatusToggle.getAttribute("aria-expanded"),
        "false"
    );
    assert.strictEqual(
        result.elements.dataStatusToggle.getAttribute("aria-controls"),
        "dataStatus"
    );
});

test("Nut trang thai mo va dong vung chi tiet", function() {
    const result = createContextWithPayload(createVersion2Payload([createVersion2Task()]));

    result.elements.dataStatusToggle.click();
    assert.strictEqual(result.elements.dataStatus.hidden, false);
    assert.strictEqual(
        result.elements.dataStatusToggle.getAttribute("aria-expanded"),
        "true"
    );

    result.elements.dataStatusToggle.click();
    assert.strictEqual(result.elements.dataStatus.hidden, true);
    assert.strictEqual(
        result.elements.dataStatusToggle.getAttribute("aria-expanded"),
        "false"
    );
});

test("Nut trang thai du lieu cach ly tu mo chi tiet", function() {
    const result = createContextWithPayload("{broken");

    assert.strictEqual(
        result.elements.dataStatusSummary.textContent,
        "⚠ Dữ liệu đã được cách ly"
    );
    assert.strictEqual(result.elements.dataStatus.hidden, false);
    assert.strictEqual(
        result.elements.dataStatusToggle.getAttribute("aria-expanded"),
        "true"
    );
});

test("Nut trang thai migration tu mo chi tiet", function() {
    const result = createContextWithPayload(JSON.stringify([{
        id: 1700000000000,
        name: "Du lieu cu",
        completed: false
    }]));

    assert.strictEqual(
        result.elements.dataStatusSummary.textContent,
        "✓ Đã nâng cấp dữ liệu"
    );
    assert.strictEqual(result.elements.dataStatus.hidden, false);
    assert.strictEqual(
        result.elements.dataStatusToggle.getAttribute("aria-expanded"),
        "true"
    );
});

test("Nut trang thai future version tu mo va hien thi chi doc", function() {
    const futureVersion = 9;
    const result = createContextWithPayload(JSON.stringify({
        version: futureVersion,
        tasks: [createVersion2Task()]
    }));

    assert.strictEqual(
        result.elements.dataStatusSummary.textContent,
        "⚠ Chế độ chỉ đọc – Version 9"
    );
    assert.strictEqual(result.elements.dataStatus.hidden, false);
    assert.strictEqual(
        result.elements.dataStatusToggle.getAttribute("aria-expanded"),
        "true"
    );
    assert.strictEqual(result.elements.dataUsageMode.textContent, "Chỉ đọc");
    assert.strictEqual(result.elements.taskInput.disabled, true);

    result.elements.dataStatusToggle.click();
    assert.strictEqual(result.elements.dataStatus.hidden, true);
    assert.strictEqual(
        result.elements.dataStatusSummary.textContent,
        "⚠ Chế độ chỉ đọc – Version 9"
    );
});

runTests().catch(function(error) {
    console.error(error);
    process.exitCode = 1;
});
