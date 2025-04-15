// Global execution control
let isExecuting = false;
let shouldStop = false;

// Define registers and memory with proper types
const registers = {
  ax: 0, bx: 0, cx: 0, dx: 0,
  si: 0, di: 0, sp: 0xFFF0, bp: 0,
  ip: 0,
  flags: { ZF: 0, SF: 0, CF: 0, OF: 0, PF: 0, AF: 0, DF: 0 }
};

const memory = new Uint8Array(1024 * 1024);

// Utility functions for register and flag handling
function setRegister(reg, value) {
  // Ensure 16-bit unsigned value (0-65535)
  registers[reg] = ((value % 65536) + 65536) % 65536;
}

function getRegister(reg) {
  return registers[reg];
}

// Flag setting utilities
function updateFlags(result, carryFlag = false, overflowFlag = false) {
  // Zero Flag (ZF): Set if result is zero
  registers.flags.ZF = (result & 0xFFFF) === 0 ? 1 : 0;
  
  // Sign Flag (SF): Set if result is negative (bit 15 is 1)
  registers.flags.SF = (result & 0x8000) !== 0 ? 1 : 0;
  
  // Carry Flag (CF): Set if operation resulted in carry/borrow
  registers.flags.CF = carryFlag ? 1 : 0;
  
  // Overflow Flag (OF): Set if signed arithmetic overflow occurred
  registers.flags.OF = overflowFlag ? 1 : 0;
  
  // Parity Flag (PF): Set if number of 1 bits in least significant byte is even
  let bits = result & 0xFF;
  bits = bits ^ (bits >> 4);
  bits = bits ^ (bits >> 2);
  bits = bits ^ (bits >> 1);
  registers.flags.PF = (~bits & 1);
  
  // Auxiliary Flag (AF): Set if carry from bit 3 to bit 4
  registers.flags.AF = 0; // Simplified for now
}

function checkOverflow(op1, op2, result, isAdd) {
  op1 &= 0xFFFF;
  op2 &= 0xFFFF;
  result &= 0xFFFF;
  
  // For addition
  if (isAdd) {
    const sign1 = (op1 & 0x8000) !== 0;
    const sign2 = (op2 & 0x8000) !== 0;
    const signR = (result & 0x8000) !== 0;
    return (sign1 === sign2 && sign1 !== signR) ? 1 : 0;
  }
  // For subtraction
  else {
    const sign1 = (op1 & 0x8000) !== 0;
    const sign2 = (op2 & 0x8000) !== 0;
    const signR = (result & 0x8000) !== 0;
    return (sign1 !== sign2 && sign2 === signR) ? 1 : 0;
  }
}

async function executeInstruction(instruction, labelMap) {
  const line = instruction.split(';')[0].trim();
  if (!line) return;

  const match = line.match(/^(\w+)\s*(.*)$/);
  if (!match) throw 'Invalid instruction format';

  const instr = match[1].toLowerCase();
  const argStr = match[2].trim();
  const args = argStr ? argStr.split(',').map(a => a.trim()) : [];

  // Parse memory address from [address] format
  function parseMemoryAddress(arg) {
    const memMatch = arg.match(/\[(.*?)\]/);
    if (!memMatch) return null;
    const addr = parseInt(memMatch[1]);
    if (isNaN(addr)) throw `Invalid memory address: ${arg}`;
    return addr;
  }

  // Write word (16-bit) to memory
  function writeWord(address, value) {
    memory[address] = value & 0xFF;           // Low byte
    memory[address + 1] = (value >> 8) & 0xFF; // High byte
    updateMemoryView(); // Update memory display after write
  }

  // Read word (16-bit) from memory
  function readWord(address) {
    return memory[address] | (memory[address + 1] << 8);
  }

  try {
    switch (instr) {
      case 'mov': {
        if (args.length < 2) throw 'Missing arguments';
        const dest = args[0].toLowerCase();
        const src = args[1].toLowerCase();
        
        const destAddr = parseMemoryAddress(dest);
        const srcAddr = parseMemoryAddress(src);
        
        if (destAddr !== null) {
          const value = (src in registers) ? getRegister(src) : parseInt(src);
          if (isNaN(value)) throw `Invalid MOV value: ${src}`;
          writeWord(destAddr, value);
        } else if (srcAddr !== null) {
          if (!(dest in registers)) throw `Invalid destination register: ${dest}`;
          setRegister(dest, readWord(srcAddr));
        } else {
          const value = (src in registers) ? getRegister(src) : parseInt(src);
          if (isNaN(value)) throw `Invalid MOV value: ${src}`;
          if (!(dest in registers)) throw `Invalid destination register: ${dest}`;
          setRegister(dest, value);
        }
        break;
      }

      case 'push': {
        if (args.length < 1) throw 'Missing argument for PUSH';
        const src = args[0].toLowerCase();
        const value = (src in registers) ? getRegister(src) : parseInt(src);
        if (isNaN(value)) throw `Invalid PUSH value: ${src}`;
        
        registers.sp -= 2;
        writeWord(registers.sp, value);
        break;
      }

      case 'pop': {
        if (args.length < 1) throw 'Missing argument for POP';
        const dest = args[0].toLowerCase();
        if (!(dest in registers)) throw `Invalid destination register: ${dest}`;
        
        const value = readWord(registers.sp);
        registers.sp += 2;
        setRegister(dest, value);
        break;
      }

      case 'add': {
        if (args.length < 2) throw 'Missing arguments';
        const dest = args[0].toLowerCase();
        const src = args[1].toLowerCase();
        const value = (src in registers) ? getRegister(src) : parseInt(src);
        if (isNaN(value)) throw `Invalid ADD value: ${src}`;
        if (!(dest in registers)) throw `Invalid destination register: ${dest}`;
        
        const op1 = getRegister(dest);
        const result = op1 + value;
        
        setRegister(dest, result);
        updateFlags(
          result,
          result > 0xFFFF,  // Carry
          checkOverflow(op1, value, result, true)  // Overflow
        );
        break;
      }

      case 'sub': {
        if (args.length < 2) throw 'Missing arguments';
        const dest = args[0].toLowerCase();
        const src = args[1].toLowerCase();
        const value = (src in registers) ? getRegister(src) : parseInt(src);
        if (isNaN(value)) throw `Invalid SUB value: ${src}`;
        if (!(dest in registers)) throw `Invalid destination register: ${dest}`;
        
        const op1 = getRegister(dest);
        const result = op1 - value;
        
        setRegister(dest, result);
        updateFlags(
          result,
          op1 < value,  // Carry (borrow)
          checkOverflow(op1, value, result, false)  // Overflow
        );
        break;
      }

      case 'mul': {
        if (args.length < 1) throw 'Missing argument';
        const src = args[0].toLowerCase();
        const value = (src in registers) ? getRegister(src) : parseInt(src);
        if (isNaN(value)) throw `Invalid MUL value: ${src}`;
        
        const result = getRegister('ax') * value;
        setRegister('ax', result);
        const hasUpperBits = result > 0xFFFF;
        registers.flags.CF = hasUpperBits ? 1 : 0;
        registers.flags.OF = hasUpperBits ? 1 : 0;
        break;
      }

      case 'div': {
        if (args.length < 1) throw 'Missing argument';
        const src = args[0].toLowerCase();
        const divisor = (src in registers) ? getRegister(src) : parseInt(src);
        if (isNaN(divisor) || divisor === 0) throw `Invalid DIV divisor: ${src}`;
        
        const dividend = getRegister('ax');
        const quotient = Math.floor(dividend / divisor);
        const remainder = dividend % divisor;
        
        if (quotient > 0xFFFF) throw 'Division overflow';
        
        setRegister('ax', quotient);
        setRegister('dx', remainder);
        break;
      }

      default: {
        throw `Unknown instruction: ${instr}`;
      }
    }
  } catch (err) {
    throw err;
  }
}

function updateUI() {
  const regDiv = document.getElementById('registers');
  let output = '<h2>Registers:</h2><div class="register-grid">';
  
  // Display general purpose registers in hexadecimal
  for (let r in registers) {
    if (r !== 'flags') {
      const value = registers[r];
      output += `
        <div class="register-item">
          <span class="register-name">${r.toUpperCase()}:</span>
          <span class="register-value">${value.toString(16).padStart(4, '0')}h</span>
        </div>
      `;
    }
  }
  
  output += '</div><div class="flags">';
  
  // Display flags as binary (0 or 1)
  for (let flag in registers.flags) {
    output += `
      <div class="flag ${registers.flags[flag] ? 'active' : ''}">
        ${flag}: ${registers.flags[flag]}
      </div>
    `;
  }
  
  output += '</div>';
  regDiv.innerHTML = output;

  // Update memory view
  updateMemoryView();
}

function hideError() {
  const errorDiv = document.getElementById('error');
  errorDiv.style.display = 'none';
  errorDiv.innerText = '';
}

function showError(message) {
  const errorDiv = document.getElementById('error');
  errorDiv.style.display = 'block';
  errorDiv.innerText = message;
}

function updateMemoryView() {
  const memoryDiv = document.getElementById('memoryView');
  const addressInput = document.getElementById('memoryAddress');
  
  // Parse the starting address from hex input
  let startAddr = parseInt(addressInput.value, 16) || 0;
  startAddr = Math.max(0, Math.min(startAddr, memory.length - 128));
  
  // Show 8 rows of 16 bytes each
  let output = '';
  
  // Add header
  output += `<div class="memory-row header">
    <span class="memory-address">Memory</span>
    <span class="memory-hex">00</span>
    <span class="memory-hex">01</span>
    <span class="memory-hex">02</span>
    <span class="memory-hex">03</span>
    <span class="memory-hex">04</span>
    <span class="memory-hex">05</span>
    <span class="memory-hex">06</span>
    <span class="memory-hex">07</span>
    <span class="memory-hex">08</span>
    <span class="memory-hex">09</span>
    <span class="memory-hex">0A</span>
    <span class="memory-hex">0B</span>
    <span class="memory-hex">0C</span>
    <span class="memory-hex">0D</span>
    <span class="memory-hex">0E</span>
    <span class="memory-hex">0F</span>
  </div>`;
  
  for (let i = 0; i < 8; i++) {
    const rowAddr = startAddr + (i * 16);
    let rowOutput = `<div class="memory-row">
      <span class="memory-address">${rowAddr.toString(16).padStart(5, '0').toUpperCase()}</span>`;
    
    // Process 16 bytes per row
    for (let j = 0; j < 16; j++) {
      const byte = memory[rowAddr + j];
      rowOutput += `<span class="memory-hex">${byte.toString(16).padStart(2, '0').toUpperCase()}</span>`;
    }
    
    rowOutput += '</div>';
    output += rowOutput;
  }
  
  memoryDiv.innerHTML = output;
  
  // Update address input with normalized value
  addressInput.value = startAddr.toString(16).padStart(5, '0').toUpperCase();
}

function initializeMemory() {
  // Clear all memory to zeros
  memory.fill(0);
}

function resetEmulator() {
  // Reset registers
  registers.ax = registers.bx = registers.cx = registers.dx = 0;
  registers.si = registers.di = 0;
  registers.sp = 0xFFF0;
  registers.bp = 0;
  registers.ip = 0;
  
  // Reset flags
  for (let flag in registers.flags) {
    registers.flags[flag] = 0;
  }
  
  // Initialize memory to all zeros
  initializeMemory();
  
  // Hide error message
  hideError();
  
  // Update UI
  updateUI();
}

function stopExecution() {
  shouldStop = true;
}

function updateProgress(current, total) {
  const progress = document.getElementById('progress');
  const progressBar = document.getElementById('progressBar');
  progressBar.style.display = 'block';
  progress.style.width = `${(current / total) * 100}%`;
}

async function processInstructions(instructions, labelMap) {
  const CHUNK_SIZE = 100;
  const total = instructions.length;
  let i = 0;

  while (i < total && !shouldStop) {
    const endIndex = Math.min(i + CHUNK_SIZE, total);
    
    for (let j = i; j < endIndex; j++) {
      const instruction = instructions[j];
      if (instruction.trim() === '' || instruction.trim().endsWith(':')) continue;
      
      try {
        await executeInstruction(instruction, labelMap);
        updateUI(); // Update UI after each instruction
      } catch (err) {
        showError(`Line ${j + 1}: ${err}`);
        return false;
      }
    }

    updateProgress(endIndex, total);
    await new Promise(resolve => setTimeout(resolve, 0));
    i = endIndex;
  }

  return !shouldStop;
}

async function runCode() {
  if (isExecuting) return;
  isExecuting = true;
  shouldStop = false;

  try {
    const runButton = document.getElementById('runButton');
    const codeEditor = document.getElementById('code');
    runButton.classList.add('running');
    codeEditor.classList.add('running');

    // Reset emulator state and hide any previous errors
    resetEmulator();
    hideError();

    // Parse code
    const codeLines = codeEditor.value.split('\n');
    
    // Build label map
    const labelMap = {};
    codeLines.forEach((line, index) => {
      const cleanLine = line.split(';')[0].trim();
      if (cleanLine.endsWith(':')) {
        labelMap[cleanLine.slice(0, -1).toLowerCase()] = index;
      }
    });

    // Execute instructions
    await processInstructions(codeLines, labelMap);
  } catch (err) {
    showError(`Execution error: ${err.message || err}`);
  } finally {
    // Cleanup
    isExecuting = false;
    shouldStop = false;
    document.getElementById('runButton').classList.remove('running');
    document.getElementById('code').classList.remove('running');
    document.getElementById('progressBar').style.display = 'none';
    updateUI();
  }
}

// Initialize the emulator when the page loads
window.onload = function() {
  resetEmulator();
  updateMemoryView();
  // Add event listener for code editor to hide error when typing
  document.getElementById('code').addEventListener('input', hideError);
}; 