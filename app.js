const STORAGE_KEY = "taskManagerTasks";

const taskInput = document.getElementById("taskInput");
const addTaskButton = document.getElementById("addTaskButton");
const taskList = document.getElementById("taskList");
const totalTasks = document.getElementById("totalTasks");
const completedTasks = document.getElementById("completedTasks");

let tasks = loadTasks();

function loadTasks() {
    const savedTasks = localStorage.getItem(STORAGE_KEY);

    if (savedTasks) {
        return JSON.parse(savedTasks);
    }

    return [];
}

function saveTasks() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function addTask() {
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

taskInput.addEventListener("keydown", function(event) {
    if (event.key === "Enter") {
        addTask();
    }
});

renderTasks();
