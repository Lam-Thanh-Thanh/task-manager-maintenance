const STORAGE_KEY = "taskManagerTasks";
const CORRUPTED_STORAGE_PREFIX = STORAGE_KEY + "_corrupted_";
const MIGRATION_BACKUP_PREFIX = STORAGE_KEY + "_migration_backup_";
const STORAGE_VERSION = 2;

const taskInput = document.getElementById("taskInput");
const addTaskButton = document.getElementById("addTaskButton");
const taskList = document.getElementById("taskList");
const totalTasks = document.getElementById("totalTasks");
const completedTasks = document.getElementById("completedTasks");
const storageWarning = document.getElementById("storageWarning");
const storageWarningMessage = document.getElementById("storageWarningMessage");
const closeStorageWarningButton = document.getElementById("closeStorageWarningButton");

let storageWritesEnabled = true;
let readOnlyMode = false;
let tasks = loadTasks();

function isValidTask(task) {
    if (typeof task !== "object" || task === null || Array.isArray(task)) {
        return false;
    }

    const hasValidId =
        (typeof task.id === "number" && Number.isFinite(task.id)) ||
        (typeof task.id === "string" && task.id.trim() !== "");

    return hasValidId &&
        typeof task.name === "string" &&
        task.name.trim() !== "" &&
        typeof task.completed === "boolean";
}

function isValidIsoDateTime(value) {
    const isoDateTimePattern =
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;

    return typeof value === "string" &&
        isoDateTimePattern.test(value) &&
        !Number.isNaN(Date.parse(value));
}

function isValidVersion2Task(task) {
    if (!isValidTask(task) ||
        !isValidIsoDateTime(task.createdAt) ||
        !isValidIsoDateTime(task.updatedAt)) {
        return false;
    }

    return Date.parse(task.updatedAt) >= Date.parse(task.createdAt);
}

function isValidVersion2Storage(storedData) {
    return typeof storedData === "object" &&
        storedData !== null &&
        !Array.isArray(storedData) &&
        storedData.version === STORAGE_VERSION &&
        Array.isArray(storedData.tasks) &&
        storedData.tasks.every(isValidVersion2Task);
}

function isFutureVersion(storedData) {
    return typeof storedData === "object" &&
        storedData !== null &&
        !Array.isArray(storedData) &&
        Number.isInteger(storedData.version) &&
        storedData.version > STORAGE_VERSION;
}

function parseStoredData(savedTasks) {
    try {
        return { isValidJson: true, data: JSON.parse(savedTasks) };
    } catch (error) {
        return { isValidJson: false, data: null };
    }
}

function createUniqueStorageKey(prefix) {
    const timestamp = Date.now();
    let backupKey = prefix + timestamp;
    let suffix = 1;

    while (localStorage.getItem(backupKey) !== null) {
        backupKey = prefix + timestamp + "_" + suffix;
        suffix += 1;
    }

    return backupKey;
}

function quarantineCorruptedData(savedTasks) {
    let backupKey;

    try {
        backupKey = createUniqueStorageKey(CORRUPTED_STORAGE_PREFIX);
        localStorage.setItem(backupKey, savedTasks);
    } catch (error) {
        return { backupCreated: false, originalRemoved: false };
    }

    try {
        localStorage.removeItem(STORAGE_KEY);
        return { backupCreated: true, originalRemoved: true, backupKey };
    } catch (error) {
        return { backupCreated: true, originalRemoved: false, backupKey };
    }
}

function createMigrationBackup(savedTasks) {
    try {
        const backupKey = createUniqueStorageKey(MIGRATION_BACKUP_PREFIX);
        localStorage.setItem(backupKey, savedTasks);
        return { success: true, backupKey };
    } catch (error) {
        return { success: false };
    }
}

function inferTimestampFromId(taskId) {
    let timestamp;

    if (typeof taskId === "number") {
        timestamp = taskId;
    } else if (/^\d+$/.test(taskId.trim())) {
        timestamp = Number(taskId);
    } else {
        return null;
    }

    if (!Number.isFinite(timestamp)) {
        return null;
    }

    if (timestamp >= 946684800 && timestamp < 10000000000) {
        timestamp *= 1000;
    }

    if (timestamp < 946684800000 || timestamp > 253402300799999) {
        return null;
    }

    return Number.isNaN(new Date(timestamp).getTime()) ? null : timestamp;
}

function createMigratedTasks(legacyTasks) {
    const fallbackTimestamp = Date.now();

    return legacyTasks.map(function(task, index) {
        const inferredTimestamp = inferTimestampFromId(task.id);
        const createdAt = new Date(
            inferredTimestamp === null ? fallbackTimestamp + index : inferredTimestamp
        ).toISOString();

        return Object.assign({}, task, {
            createdAt,
            updatedAt: createdAt
        });
    });
}

function migrateLegacyTasks(legacyTasks, savedTasks) {
    const backupResult = createMigrationBackup(savedTasks);

    if (!backupResult.success) {
        return { success: false, reason: "backup-failed", tasks: legacyTasks };
    }

    try {
        const migratedTasks = createMigratedTasks(legacyTasks);
        const versionedData = {
            version: STORAGE_VERSION,
            tasks: migratedTasks
        };

        if (!isValidVersion2Storage(versionedData)) {
            throw new Error("Du lieu sau migration khong hop le");
        }

        localStorage.setItem(STORAGE_KEY, JSON.stringify(versionedData));

        return {
            success: true,
            tasks: migratedTasks,
            backupKey: backupResult.backupKey
        };
    } catch (error) {
        return {
            success: false,
            reason: "migration-failed",
            tasks: legacyTasks,
            backupKey: backupResult.backupKey
        };
    }
}

function showStorageWarning(quarantineResult) {
    if (!quarantineResult.backupCreated) {
        storageWarningMessage.textContent =
            "Dữ liệu công việc bị lỗi và chưa thể sao lưu. Dữ liệu gốc vẫn được giữ nguyên; ứng dụng tạm thời mở với danh sách trống.";
    } else if (!quarantineResult.originalRemoved) {
        storageWarningMessage.textContent =
            "Dữ liệu công việc bị lỗi. Một bản sao an toàn đã được lưu, nhưng dữ liệu lỗi chưa thể xóa. Ứng dụng tạm thời mở với danh sách trống.";
    } else {
        storageWarningMessage.textContent =
            "Dữ liệu công việc bị lỗi. Một bản sao an toàn đã được lưu và ứng dụng đã mở với danh sách trống.";
    }

    storageWarning.hidden = false;
}

function showStorageReadWarning() {
    storageWarningMessage.textContent =
        "Không thể đọc dữ liệu công việc. Dữ liệu hiện có không bị thay đổi; ứng dụng tạm thời mở với danh sách trống.";
    storageWarning.hidden = false;
}

function showMigrationSuccess() {
    storageWarningMessage.textContent =
        "Dữ liệu công việc đã được nâng cấp thành công. Một bản sao dữ liệu cũ cũng đã được lưu an toàn.";
    storageWarning.classList.add("storage-notice-success");
    storageWarning.hidden = false;
}

function showMigrationFailure(reason) {
    if (reason === "backup-failed") {
        storageWarningMessage.textContent =
            "Chưa thể sao lưu dữ liệu cũ nên quá trình nâng cấp đã dừng. Dữ liệu gốc được giữ nguyên và các thay đổi trong phiên này sẽ không được lưu.";
    } else {
        storageWarningMessage.textContent =
            "Không thể hoàn tất nâng cấp dữ liệu. Dữ liệu gốc và bản sao an toàn được giữ nguyên; các thay đổi trong phiên này sẽ không được lưu.";
    }

    storageWarning.hidden = false;
}

function showFutureVersionWarning() {
    storageWarningMessage.textContent =
        "Chế độ chỉ đọc: Dữ liệu được tạo bởi phiên bản mới hơn của ứng dụng. Các thao tác chỉnh sửa đã bị vô hiệu hóa và dữ liệu được giữ nguyên.";
    storageWarning.hidden = false;
}

function enableReadOnlyMode() {
    readOnlyMode = true;
    storageWritesEnabled = false;
    taskInput.disabled = true;
    addTaskButton.disabled = true;
    closeStorageWarningButton.hidden = true;
}

function getReadableFutureTasks(storedData) {
    if (!Array.isArray(storedData.tasks) || !storedData.tasks.every(isValidTask)) {
        return [];
    }

    return storedData.tasks;
}

function loadTasks() {
    let savedTasks;

    try {
        savedTasks = localStorage.getItem(STORAGE_KEY);
    } catch (error) {
        storageWritesEnabled = false;
        showStorageReadWarning();
        return [];
    }

    if (savedTasks === null) {
        return [];
    }

    const parseResult = parseStoredData(savedTasks);

    if (!parseResult.isValidJson) {
        showStorageWarning(quarantineCorruptedData(savedTasks));
        return [];
    }

    const storedData = parseResult.data;

    if (Array.isArray(storedData)) {
        if (!storedData.every(isValidTask)) {
            showStorageWarning(quarantineCorruptedData(savedTasks));
            return [];
        }

        const migrationResult = migrateLegacyTasks(storedData, savedTasks);

        if (migrationResult.success) {
            showMigrationSuccess();
            return migrationResult.tasks;
        }

        storageWritesEnabled = false;
        showMigrationFailure(migrationResult.reason);
        return migrationResult.tasks;
    }

    if (isFutureVersion(storedData)) {
        enableReadOnlyMode();
        showFutureVersionWarning();
        return getReadableFutureTasks(storedData);
    }

    if (isValidVersion2Storage(storedData)) {
        return storedData.tasks;
    }

    showStorageWarning(quarantineCorruptedData(savedTasks));
    return [];
}

function saveTasks() {
    if (!storageWritesEnabled) {
        return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: STORAGE_VERSION,
        tasks
    }));
}

function createCurrentTimestamp() {
    return new Date(Date.now()).toISOString();
}

function createUpdatedTimestamp(task) {
    const currentTimestamp = Date.now();
    const createdTimestamp = Date.parse(task.createdAt);
    const updatedTimestamp = Number.isNaN(createdTimestamp)
        ? currentTimestamp
        : Math.max(currentTimestamp, createdTimestamp);

    return new Date(updatedTimestamp).toISOString();
}

/*function addTask() {
    const task = {
        id: Date.now(),
        name: taskInput.value,
        completed: false
    };

    tasks.push(task);
    saveTasks();
    renderTasks();
    taskInput.value = "";
    taskInput.focus();
}*/
function addTask() {
    if (readOnlyMode) {
        return;
    }

    const taskName = taskInput.value.trim();

    if (taskName === "") {
        alert("Vui lòng nhập tên công việc.");
        taskInput.focus();
        return;
    }

    const timestamp = createCurrentTimestamp();
    const task = {
        id: Date.now(),
        name: taskName,
        completed: false,
        createdAt: timestamp,
        updatedAt: timestamp
    };

    tasks.push(task);
    saveTasks();
    renderTasks();
    taskInput.value = "";
    taskInput.focus();
}

function toggleTask(taskId) {
    if (readOnlyMode) {
        return;
    }

    tasks = tasks.map(function(task) {
        if (task.id === taskId) {
            return Object.assign({}, task, {
                completed: !task.completed,
                updatedAt: createUpdatedTimestamp(task)
            });
        }

        return task;
    });

    saveTasks();
    renderTasks();
}

function deleteTask(taskId) {
    if (readOnlyMode) {
        return;
    }

    tasks = tasks.filter(function(task) {
        return task.id !== taskId;
    });

    saveTasks();
    renderTasks();
}

function renderTasks() {
    taskList.innerHTML = "";

    tasks.forEach(function(task) {
        const taskItem = document.createElement("li");
        taskItem.className = "task-item";

        if (task.completed) {
            taskItem.classList.add("completed");
        }

        const taskContent = document.createElement("label");
        taskContent.className = "task-content";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = task.completed;
        checkbox.disabled = readOnlyMode;
        checkbox.addEventListener("change", function() {
            toggleTask(task.id);
        });

        const taskName = document.createElement("span");
        taskName.className = "task-name";
        taskName.textContent = task.name;

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "delete-button";
        deleteButton.textContent = "Xóa";
        deleteButton.disabled = readOnlyMode;
        deleteButton.addEventListener("click", function() {
            deleteTask(task.id);
        });

        taskContent.appendChild(checkbox);
        taskContent.appendChild(taskName);
        taskItem.appendChild(taskContent);
        taskItem.appendChild(deleteButton);
        taskList.appendChild(taskItem);
    });

    renderStats();
}

function renderStats() {
    const completedCount = tasks.filter(function(task) {
        return task.completed;
    }).length;

    totalTasks.textContent = tasks.length;
    completedTasks.textContent = completedCount;
}

addTaskButton.addEventListener("click", addTask);

closeStorageWarningButton.addEventListener("click", function() {
    if (readOnlyMode) {
        return;
    }

    storageWarning.hidden = true;
});

taskInput.addEventListener("keydown", function(event) {
    if (event.key === "Enter") {
        addTask();
    }
});

renderTasks();
