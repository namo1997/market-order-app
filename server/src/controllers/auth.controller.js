import * as userModel from '../models/user.model.js';
import { generateToken } from '../utils/jwt.js';

// ดึงรายการสาขา
export const getBranches = async (req, res, next) => {
  try {
    const branches = await userModel.getAllBranches();
    res.json({
      success: true,
      data: branches
    });
  } catch (error) {
    next(error);
  }
};

// ดึงรายการแผนกตามสาขา
export const getDepartments = async (req, res, next) => {
  try {
    const { branchId } = req.params;
    const departments = await userModel.getDepartmentsByBranch(branchId);
    res.json({
      success: true,
      data: departments
    });
  } catch (error) {
    next(error);
  }
};

// ดึงรายการผู้ใช้ตามแผนก
export const getUsers = async (req, res, next) => {
  try {
    const { departmentId } = req.params;
    const users = await userModel.getUsersByDepartment(departmentId);
    res.json({
      success: true,
      data: users
    });
  } catch (error) {
    next(error);
  }
};

// Login
export const login = async (req, res, next) => {
  try {
    const { departmentId, userId } = req.body;

    if (!departmentId && !userId) {
      return res.status(400).json({
        success: false,
        message: 'Department ID is required'
      });
    }

    if (!departmentId && userId) {
      const user = await userModel.getUserById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const token = generateToken({
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        department_id: user.department_id,
        branch_id: user.branch_id
      });

      const userPayload = {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        department: user.department_name,
        branch: user.branch_name
      };

      return res.json({
        success: true,
        message: 'Login successful',
        data: {
          token,
          user: userPayload
        }
      });
    }

    const department = await userModel.getDepartmentById(departmentId);

    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found'
      });
    }

    const departmentUsername = `dept_${departmentId}`;
    let user = await userModel.getUserByUsername(departmentUsername);
    const isCentralBranch = department.branch_name === 'สาขาส่วนกลาง';

    if (!user) {
      const created = await userModel.createUser({
        username: departmentUsername,
        name: department.name,
        role: isCentralBranch ? 'admin' : 'user',
        department_id: departmentId
      });
      user = await userModel.getUserById(created.id);
    } else if (isCentralBranch && user.role !== 'admin') {
      await userModel.updateUser(user.id, {
        name: user.name,
        role: 'admin',
        department_id: user.department_id
      });
      user = await userModel.getUserById(user.id);
    }

    // สร้าง JWT token
    const token = generateToken({
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      department_id: user.department_id,
      branch_id: user.branch_id
    });

    const userPayload = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      department: user.department_name,
      branch: user.branch_name
    };

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: userPayload
      }
    });
  } catch (error) {
    next(error);
  }
};

// Super Admin Login (PIN)
export const loginSuperAdmin = async (req, res, next) => {
  try {
    const { pin } = req.body;
    const expectedPin = process.env.SUPER_ADMIN_PIN || '1997';

    if (!pin || String(pin) !== String(expectedPin)) {
      return res.status(401).json({
        success: false,
        message: 'PIN ไม่ถูกต้อง'
      });
    }

    const username = 'supper_admin';
    const name = 'supper admin';
    const role = 'super_admin';

    let user = await userModel.getUserByUsername(username);

    if (!user) {
      const defaultDept = await userModel.getDefaultAdminDepartment();

      if (!defaultDept) {
        return res.status(400).json({
          success: false,
          message: 'ไม่พบแผนกสำหรับ Super Admin'
        });
      }

      let created;
      try {
        created = await userModel.createUser({
          username,
          name,
          role,
          department_id: defaultDept.id
        });
      } catch (err) {
        if (
          err?.code === 'ER_WRONG_VALUE_FOR_TYPE' ||
          err?.code === 'ER_TRUNCATED_WRONG_VALUE' ||
          String(err?.message || '').includes('Data truncated for column')
        ) {
          created = await userModel.createUser({
            username,
            name,
            role: 'admin',
            department_id: defaultDept.id
          });
        } else {
          throw err;
        }
      }
      user = await userModel.getUserById(created.id);
    }

    const token = generateToken({
      id: user.id,
      username: user.username,
      name: user.name,
      role,
      department_id: user.department_id,
      branch_id: user.branch_id
    });

    const userPayload = {
      id: user.id,
      username: user.username,
      name: user.name,
      role,
      department: user.department_name,
      branch: user.branch_name
    };

    return res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: userPayload
      }
    });
  } catch (error) {
    next(error);
  }
};

// ดึงข้อมูล user ปัจจุบัน (จาก token)
export const getCurrentUser = async (req, res, next) => {
  try {
    const user = await userModel.getUserById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    next(error);
  }
};
