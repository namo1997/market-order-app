import * as userModel from '../models/user.model.js';

export const getAllUsers = async (req, res, next) => {
    try {
        // For now, reusing getSchema logic or if specific filters needed
        // Assuming admin wants list of users, maybe filtered by deps/branch
        // Leveraging existing models or creating new generic getAll if needed.
        // userModel.getUsersByDepartment is specific.
        // Let's add a generic getAllUsers to userModel if not exists, or iterate departments?
        // Actually, let's create a specific admin-level generic fetch if needed, 
        // but for now let's use what we have or add to model.
        // Wait, I updated user.model.js but didn't add getAllUsers generic.
        // I should add it to model first or just reuse the existing specific ones?
        // Let's just create a direct query here or add to model.
        // Adding to model is better practice. I will add getAllUsers to model in next step if needed.
        // For now, let's just scaffold the controller.

        // TEMPORARY: using direct query via pool if model update is pending or assumed.
        // Actually I'll stick to model pattern. I'll add getAllUsers to user.model.js as well.
        // Re-checking user.model.js content... it has getters by department.
        // I will implementation getAllUsers in model first? 
        // No, I can't interrupt write_to_file.
        // I will write this controller assuming the model has it, then update model.

        const users = await userModel.getAllUsers();
        res.json({ success: true, data: users });
    } catch (error) {
        next(error);
    }
};

export const createUser = async (req, res, next) => {
    try {
        const { username, name, role, department_id } = req.body;

        // Initial validation
        if (!username || !name || !role || !department_id) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }

        const user = await userModel.createUser({
            username,
            name,
            role,
            department_id
        });

        res.status(201).json({ success: true, data: user });
    } catch (error) {
        next(error);
    }
};

export const updateUser = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, role, department_id } = req.body;

        const user = await userModel.updateUser(id, { name, role, department_id });

        res.json({ success: true, data: user });
    } catch (error) {
        next(error);
    }
};

export const deleteUser = async (req, res, next) => {
    try {
        const { id } = req.params;
        await userModel.deleteUser(id);
        res.json({ success: true, message: 'User deleted successfully' });
    } catch (error) {
        next(error);
    }
};
