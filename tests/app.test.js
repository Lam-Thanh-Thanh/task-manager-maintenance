const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

function createElement(tagName) {
    return {
        tagName: tagName.toUpperCase(),
        children: [],
        className: "",
        innerHTML: "",
        textContent: "",
        type: "",
        checked: false,
        value: "",
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
}

function createTestContext() {
    const elements = {
        taskInput: createElement("input"),
        addTaskButton: createElement("button"),
        taskList: createElement("ul"),
        totalTasks: createElement("span"),
        completedTasks: createElement("span")
    };

    const storage = {};
    const alerts = [];

    const context = {
        document: {
            getElementById(id) {
                return elements[id];
            },
            createElement
        },
        localStorage: {
            getItem(key) {
                return storage[key] || null;
            },
            setItem(key, value) {
                storage[key] = value;
            }
        },
        Date: {
            now() {
                return 1001;
            }
        },
        alert(message) {
            alerts.push(message);
        }
    };

    vm.createContext(context);
    vm.runInContext(fs.readFileSync("app.js", "utf8"), context);

    return { elements, storage, alerts };
}

const { elements, storage, alerts } = createTestContext();

elements.taskInput.value = "Hoc GitHub Actions";
elements.addTaskButton.events.click();

let savedTasks = JSON.parse(storage.taskManagerTasks);
assert.strictEqual(savedTasks.length, 1);
assert.strictEqual(savedTasks[0].name, "Hoc GitHub Actions");
assert.strictEqual(savedTasks[0].completed, false);
assert.strictEqual(elements.totalTasks.textContent, 1);
assert.strictEqual(elements.completedTasks.textContent, 0);

elements.taskList.children[0].children[0].children[0].events.change();
savedTasks = JSON.parse(storage.taskManagerTasks);
assert.strictEqual(savedTasks[0].completed, true);
assert.strictEqual(elements.completedTasks.textContent, 1);

elements.taskList.children[0].children[1].events.click();
savedTasks = JSON.parse(storage.taskManagerTasks);
assert.strictEqual(savedTasks.length, 0);
assert.strictEqual(elements.totalTasks.textContent, 0);
assert.strictEqual(elements.completedTasks.textContent, 0);

elements.taskInput.value = "   ";
elements.addTaskButton.events.click();
savedTasks = storage.taskManagerTasks ? JSON.parse(storage.taskManagerTasks) : [];
assert.strictEqual(savedTasks.length, 0);
assert.strictEqual(alerts.length, 1);

console.log("Tat ca kiem thu deu thanh cong.");
