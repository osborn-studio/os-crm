/** Identity placeholders are discovery work, never evidence that a solution is confirmed. */
export function pendingCustomerName(value:unknown){return typeof value!=='string'||!value.trim()||/客户名字待核实|客户名称待核实|未具名|未命名客户|客户身份待核/.test(value);}
