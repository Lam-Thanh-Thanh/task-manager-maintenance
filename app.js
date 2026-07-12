const STORAGE_KEY = "taskManagerTasks";
const CORRUPTED_STORAGE_PREFIX = STORAGE_KEY + "_corrupted_";
const MIGRATION_BACKUP_PREFIX = STORAGE_KEY + "_migration_backup_";
const RESTORE_BACKUP_PREFIX = STORAGE_KEY + "_restore_backup_";
const STORAGE_VERSION = 2;
const BACKUP_FORMAT_VERSION = 1;
const MAX_RESTORE_FILE_SIZE = 1024 * 1024;

const taskInput = document.getElementById("taskInput");
const addTaskButton = document.getElementById("addTaskButton");
const taskList = document.getElementById("taskList");
const totalTasks = document.getElementById("totalTasks");
const completedTasks = document.getElementById("completedTasks");
const searchInput = document.getElementById("searchInput");
const filterSelect = document.getElementById("filterSelect");
const sortSelect = document.getElementById("sortSelect");
const noResultsMessage = document.getElementById("noResultsMessage");
const storageWarning = document.getElementById("storageWarning");
const storageWarningMessage = document.getElementById("storageWarningMessage");
const closeStorageWarningButton = document.getElementById("closeStorageWarningButton");
const exportBackupButton = document.getElementById("exportBackupButton");
const restoreBackupButton = document.getElementById("restoreBackupButton");
const restoreFileInput = document.getElementById("restoreFileInput");
const backupRestoreStatus = document.getElementById("backupRestoreStatus");
const restoreReadOnlyHint = document.getElementById("restoreReadOnlyHint");

let storageWritesEnabled = true;
let readOnlyMode = false;
let searchQuery = "";
let selectedFilter = "all";
let selectedSort = "newest";
let editingTaskId = null;
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
    restoreBackupButton.disabled = true;
    restoreFileInput.disabled = true;
    restoreReadOnlyHint.textContent =
        "Chế độ chỉ đọc: Bạn vẫn có thể xuất bản sao lưu nhưng không thể khôi phục dữ liệu.";
    restoreReadOnlyHint.hidden = false;
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

function showBackupRestoreStatus(message, statusType) {
    backupRestoreStatus.textContent = message;
    backupRestoreStatus.className =
        "backup-restore-status backup-restore-status-" + statusType;
    backupRestoreStatus.hidden = false;
}

function createVersion2Snapshot() {
    const snapshot = {
        version: STORAGE_VERSION,
        tasks: tasks.map(function(task) {
            return Object.assign({}, task);
        })
    };

    return isValidVersion2Storage(snapshot) ? snapshot : null;
}

function createBackupFileName(exportedAt) {
    const datePart = exportedAt.slice(0, 10);
    const timePart = exportedAt.slice(11, 19).replace(/:/g, "");
    return "task-manager-backup-" + datePart + "-" + timePart + ".json";
}

function exportBackup() {
    const dataSnapshot = createVersion2Snapshot();

    if (dataSnapshot === null) {
        showBackupRestoreStatus(
            "Không thể tạo bản sao lưu vì dữ liệu hiện tại không tương thích với định dạng sao lưu.",
            "error"
        );
        return;
    }

    const exportedAt = createCurrentTimestamp();
    const backupData = {
        backupFormatVersion: BACKUP_FORMAT_VERSION,
        exportedAt,
        data: dataSnapshot
    };
    const fileName = createBackupFileName(exportedAt);
    const blob = new Blob([
        JSON.stringify(backupData, null, 2)
    ], { type: "application/json" });
    let objectUrl;
    let downloadLink;

    try {
        objectUrl = URL.createObjectURL(blob);
        downloadLink = document.createElement("a");
        downloadLink.href = objectUrl;
        downloadLink.download = fileName;
        downloadLink.hidden = true;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        showBackupRestoreStatus(
            "Đã xuất bản sao lưu " + fileName + ".",
            "success"
        );
    } catch (error) {
        showBackupRestoreStatus(
            "Không thể xuất bản sao lưu. Vui lòng thử lại.",
            "error"
        );
    } finally {
        if (downloadLink) {
            try {
                document.body.removeChild(downloadLink);
            } catch (error) {
                // Liên kết đã được trình duyệt loại bỏ.
            }
        }

        if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
        }
    }
}

function isJsonRestoreFile(file) {
    const fileName = typeof file.name === "string" ? file.name.toLowerCase() : "";
    const fileType = typeof file.type === "string" ? file.type.toLowerCase() : "";

    return fileName.endsWith(".json") &&
        (fileType === "" || fileType === "application/json" || fileType === "text/json");
}

function parseBackupContent(fileContent) {
    let backupData;

    try {
        backupData = JSON.parse(fileContent);
    } catch (error) {
        return { success: false, message: "File không chứa JSON hợp lệ." };
    }

    if (typeof backupData !== "object" ||
        backupData === null ||
        Array.isArray(backupData) ||
        backupData.backupFormatVersion !== BACKUP_FORMAT_VERSION) {
        return { success: false, message: "Phiên bản định dạng sao lưu không được hỗ trợ." };
    }

    if (!isValidIsoDateTime(backupData.exportedAt)) {
        return { success: false, message: "Thời gian xuất trong file sao lưu không hợp lệ." };
    }

    if (!isValidVersion2Storage(backupData.data)) {
        return { success: false, message: "Dữ liệu công việc trong file sao lưu không hợp lệ." };
    }

    return { success: true, backupData };
}

function createRestoreSafetyBackup(currentStorageValue) {
    try {
        const backupKey = createUniqueStorageKey(RESTORE_BACKUP_PREFIX);
        localStorage.setItem(backupKey, currentStorageValue);

        if (localStorage.getItem(backupKey) !== currentStorageValue) {
            throw new Error("Khong the xac minh ban sao restore");
        }

        return { success: true, backupKey };
    } catch (error) {
        return { success: false };
    }
}

function restoreVersion2Data(version2Data) {
    let currentStorageValue;

    try {
        currentStorageValue = localStorage.getItem(STORAGE_KEY);
    } catch (error) {
        showBackupRestoreStatus(
            "Không thể đọc dữ liệu hiện tại nên quá trình khôi phục đã dừng.",
            "error"
        );
        return false;
    }

    const hadStoredData = currentStorageValue !== null;
    const currentSnapshot = currentStorageValue === null
        ? JSON.stringify(createVersion2Snapshot())
        : currentStorageValue;
    const safetyBackup = createRestoreSafetyBackup(currentSnapshot);

    if (!safetyBackup.success) {
        showBackupRestoreStatus(
            "Không thể tạo bản sao an toàn của dữ liệu hiện tại. Dữ liệu chưa bị thay đổi.",
            "error"
        );
        return false;
    }

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(version2Data));
    } catch (error) {
        try {
            if (hadStoredData) {
                localStorage.setItem(STORAGE_KEY, currentStorageValue);
            } else {
                localStorage.removeItem(STORAGE_KEY);
            }
        } catch (rollbackError) {
            // localStorage.setItem là thao tác nguyên tử trong trình duyệt.
        }

        showBackupRestoreStatus(
            "Không thể ghi dữ liệu khôi phục. Dữ liệu hiện tại vẫn được giữ nguyên.",
            "error"
        );
        return false;
    }

    storageWritesEnabled = true;
    editingTaskId = null;
    tasks = version2Data.tasks.map(function(task) {
        return Object.assign({}, task);
    });
    renderTasks();
    showBackupRestoreStatus(
        "Khôi phục thành công " + tasks.length + " công việc.",
        "success"
    );
    return true;
}

async function handleRestoreFile(file) {
    if (readOnlyMode) {
        showBackupRestoreStatus(
            "Chế độ chỉ đọc: Có thể xuất bản sao lưu nhưng không thể khôi phục dữ liệu.",
            "error"
        );
        return;
    }

    if (!isJsonRestoreFile(file)) {
        showBackupRestoreStatus("Chỉ chấp nhận file JSON.", "error");
        return;
    }

    if (typeof file.size !== "number" || file.size <= 0) {
        showBackupRestoreStatus("File sao lưu đang rỗng.", "error");
        return;
    }

    if (file.size > MAX_RESTORE_FILE_SIZE) {
        showBackupRestoreStatus("File sao lưu vượt quá giới hạn 1 MB.", "error");
        return;
    }

    let fileContent;

    try {
        fileContent = await file.text();
    } catch (error) {
        showBackupRestoreStatus("Không thể đọc file sao lưu.", "error");
        return;
    }

    if (fileContent.trim() === "") {
        showBackupRestoreStatus("File sao lưu đang rỗng.", "error");
        return;
    }

    const parseResult = parseBackupContent(fileContent);

    if (!parseResult.success) {
        showBackupRestoreStatus(parseResult.message, "error");
        return;
    }

    const backupData = parseResult.backupData;
    const confirmationMessage =
        "Khôi phục từ file: " + file.name + "\n" +
        "Thời gian xuất: " + backupData.exportedAt + "\n" +
        "Số công việc: " + backupData.data.tasks.length + "\n\n" +
        "Dữ liệu hiện tại sẽ được thay thế. Bạn có muốn tiếp tục?";

    if (!confirm(confirmationMessage)) {
        showBackupRestoreStatus(
            "Đã hủy khôi phục từ file " + file.name + ".",
            "info"
        );
        return;
    }

    restoreVersion2Data(backupData.data);
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

function normalizeSearchValue(value) {
    return value.trim().toLocaleLowerCase("vi");
}

function taskMatchesCurrentView(task) {
    const matchesSearch = searchQuery === "" ||
        task.name.toLocaleLowerCase("vi").includes(searchQuery);
    let matchesFilter = true;

    if (selectedFilter === "pending") {
        matchesFilter = !task.completed;
    } else if (selectedFilter === "completed") {
        matchesFilter = task.completed;
    }

    return matchesSearch && matchesFilter;
}

function getTaskCreatedTimestamp(task) {
    const timestamp = Date.parse(task.createdAt);
    return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getVisibleTasks() {
    const visibleTasks = tasks.map(function(task, originalIndex) {
        return { task, originalIndex };
    }).filter(function(item) {
        return taskMatchesCurrentView(item.task);
    });

    visibleTasks.sort(function(first, second) {
        let comparison = 0;

        if (selectedSort === "oldest") {
            comparison = getTaskCreatedTimestamp(first.task) -
                getTaskCreatedTimestamp(second.task);
        } else if (selectedSort === "name-asc") {
            comparison = first.task.name.localeCompare(
                second.task.name,
                "vi",
                { sensitivity: "base" }
            );
        } else if (selectedSort === "name-desc") {
            comparison = second.task.name.localeCompare(
                first.task.name,
                "vi",
                { sensitivity: "base" }
            );
        } else {
            comparison = getTaskCreatedTimestamp(second.task) -
                getTaskCreatedTimestamp(first.task);
        }

        return comparison === 0
            ? first.originalIndex - second.originalIndex
            : comparison;
    });

    return visibleTasks.map(function(item) {
        return item.task;
    });
}

function startEditingTask(taskId) {
    if (readOnlyMode || !tasks.some(function(task) { return task.id === taskId; })) {
        return;
    }

    editingTaskId = taskId;
    renderTasks();
}

function cancelTaskEdit(taskId) {
    if (editingTaskId !== taskId) {
        return;
    }

    editingTaskId = null;
    renderTasks();
}

function saveTaskEdit(taskId, editedName) {
    if (readOnlyMode || editingTaskId !== taskId) {
        return;
    }

    const taskName = editedName.trim();

    if (taskName === "") {
        alert("Tên công việc không được để trống.");
        return;
    }

    tasks = tasks.map(function(task) {
        if (task.id !== taskId) {
            return task;
        }

        return Object.assign({}, task, {
            name: taskName,
            updatedAt: createUpdatedTimestamp(task)
        });
    });

    editingTaskId = null;
    saveTasks();
    renderTasks();
}

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
    if (readOnlyMode || editingTaskId === taskId) {
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
    if (readOnlyMode || editingTaskId === taskId) {
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
    const visibleTasks = getVisibleTasks();
    taskList.className = visibleTasks.length === 0 ? "task-list-empty" : "";

    if (editingTaskId !== null && !visibleTasks.some(function(task) {
        return task.id === editingTaskId;
    })) {
        editingTaskId = null;
    }

    visibleTasks.forEach(function(task) {
        const taskItem = document.createElement("li");
        taskItem.className = "task-item";

        if (task.completed) {
            taskItem.classList.add("completed");
        }

        const taskContent = document.createElement("div");
        taskContent.className = "task-content";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = task.completed;
        checkbox.disabled = readOnlyMode || editingTaskId === task.id;
        checkbox.addEventListener("change", function() {
            toggleTask(task.id);
        });

        taskContent.appendChild(checkbox);

        if (editingTaskId === task.id) {
            const editInput = document.createElement("input");
            editInput.type = "text";
            editInput.className = "edit-task-input";
            editInput.value = task.name;
            editInput.disabled = readOnlyMode;
            editInput.addEventListener("keydown", function(event) {
                if (event.key === "Enter") {
                    saveTaskEdit(task.id, editInput.value);
                } else if (event.key === "Escape") {
                    cancelTaskEdit(task.id);
                }
            });

            const saveButton = document.createElement("button");
            saveButton.type = "button";
            saveButton.className = "save-button";
            saveButton.textContent = "Lưu";
            saveButton.disabled = readOnlyMode;
            saveButton.addEventListener("click", function() {
                saveTaskEdit(task.id, editInput.value);
            });

            const cancelButton = document.createElement("button");
            cancelButton.type = "button";
            cancelButton.className = "cancel-button";
            cancelButton.textContent = "Hủy";
            cancelButton.addEventListener("click", function() {
                cancelTaskEdit(task.id);
            });

            taskContent.appendChild(editInput);
            taskItem.appendChild(taskContent);
            taskItem.appendChild(saveButton);
            taskItem.appendChild(cancelButton);
            taskList.appendChild(taskItem);
            return;
        }

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

        taskContent.appendChild(taskName);
        taskItem.appendChild(taskContent);
        taskItem.appendChild(deleteButton);

        const editButton = document.createElement("button");
        editButton.type = "button";
        editButton.className = "edit-button";
        editButton.textContent = "Sửa";
        editButton.disabled = readOnlyMode;
        editButton.addEventListener("click", function() {
            startEditingTask(task.id);
        });

        taskItem.appendChild(editButton);
        taskList.appendChild(taskItem);
    });

    noResultsMessage.textContent = "Không tìm thấy công việc phù hợp.";
    noResultsMessage.hidden = visibleTasks.length !== 0;
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

searchInput.addEventListener("input", function() {
    searchQuery = normalizeSearchValue(searchInput.value);
    renderTasks();
});

filterSelect.addEventListener("change", function() {
    selectedFilter = filterSelect.value;
    renderTasks();
});

sortSelect.addEventListener("change", function() {
    selectedSort = sortSelect.value;
    renderTasks();
});

exportBackupButton.addEventListener("click", exportBackup);

restoreBackupButton.addEventListener("click", function() {
    if (readOnlyMode) {
        return;
    }

    restoreFileInput.click();
});

restoreFileInput.addEventListener("change", async function(event) {
    const file = event.target.files && event.target.files[0];

    if (!file) {
        return;
    }

    try {
        await handleRestoreFile(file);
    } finally {
        event.target.value = "";
    }
});

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
