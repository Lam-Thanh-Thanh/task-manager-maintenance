const STORAGE_KEY = "taskManagerTasks";
const CORRUPTED_STORAGE_PREFIX = STORAGE_KEY + "_corrupted_";

const taskInput = document.getElementById("taskInput");
const addTaskButton = document.getElementById("addTaskButton");
const taskList = document.getElementById("taskList");
const totalTasks = document.getElementById("totalTasks");
const completedTasks = document.getElementById("completedTasks");
const storageWarning = document.getElementById("storageWarning");
const storageWarningMessage = document.getElementById("storageWarningMessage");
const closeStorageWarningButton = document.getElementById("closeStorageWarningButton");

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

function parseStoredTasks(savedTasks) {
    try {
        const parsedTasks = JSON.parse(savedTasks);

        if (!Array.isArray(parsedTasks) || !parsedTasks.every(isValidTask)) {
            return { isValid: false, tasks: [] };
        }

        return { isValid: true, tasks: parsedTasks };
    } catch (error) {
        return { isValid: false, tasks: [] };
    }
}

function createCorruptedStorageKey() {
    const timestamp = Date.now();
    let backupKey = CORRUPTED_STORAGE_PREFIX + timestamp;
    let suffix = 1;

    while (localStorage.getItem(backupKey) !== null) {
        backupKey = CORRUPTED_STORAGE_PREFIX + timestamp + "_" + suffix;
        suffix += 1;
    }

    return backupKey;
}

function quarantineCorruptedData(savedTasks) {
    let backupKey;

    try {
        backupKey = createCorruptedStorageKey();
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

function loadTasks() {
    let savedTasks;

    try {
        savedTasks = localStorage.getItem(STORAGE_KEY);
    } catch (error) {
        showStorageReadWarning();
        return [];
    }

    if (savedTasks === null) {
        return [];
    }

    const parseResult = parseStoredTasks(savedTasks);

    if (parseResult.isValid) {
        return parseResult.tasks;
    }

    showStorageWarning(quarantineCorruptedData(savedTasks));
    return [];
}

function saveTasks() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
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
    const taskName = taskInput.value.trim();

    if (taskName === "") {
        alert("Vui lòng nhập tên công việc.");
        taskInput.focus();
        return;
    }

    const task = {
        id: Date.now(),
        name: taskName,
        completed: false
    };

    tasks.push(task);
    saveTasks();
    renderTasks();
    taskInput.value = "";
    taskInput.focus();
}

function toggleTask(taskId) {
    tasks = tasks.map(function(task) {
        if (task.id === taskId) {
            return {
                id: task.id,
                name: task.name,
                completed: !task.completed
            };
        }

        return task;
    });

    saveTasks();
    renderTasks();
}

function deleteTask(taskId) {
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
    storageWarning.hidden = true;
});

taskInput.addEventListener("keydown", function(event) {
    if (event.key === "Enter") {
        addTask();
    }
});

renderTasks();
