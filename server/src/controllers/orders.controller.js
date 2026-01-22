import * as orderModel from '../models/order.model.js';

// ตรวจสอบสถานะการเปิด/ปิดรับออเดอร์
export const getOrderStatus = async (req, res, next) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const status = await orderModel.getOrderStatus(date);

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    next(error);
  }
};

// สร้างคำสั่งซื้อใหม่
export const createOrder = async (req, res, next) => {
  try {
    const { items, order_date } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one item is required'
      });
    }
    if (!order_date) {
      return res.status(400).json({
        success: false,
        message: 'Order date is required'
      });
    }

    const orderData = {
      user_id: req.user.id,
      items,
      order_date
    };

    const order = await orderModel.createOrder(orderData);

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: order
    });
  } catch (error) {
    if (error.message === 'Order receiving is closed for selected date') {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

// ดึงคำสั่งซื้อของผู้ใช้
export const getMyOrders = async (req, res, next) => {
  try {
    const { status, date } = req.query;

    const filters = {};
    if (status) filters.status = status;
    if (date) filters.date = date;

    const orders = await orderModel.getUserOrders(req.user.id, filters);

    res.json({
      success: true,
      data: orders,
      count: orders.length
    });
  } catch (error) {
    next(error);
  }
};

// ดึงรายละเอียดคำสั่งซื้อ
export const getOrderById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await orderModel.getOrderById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // ตรวจสอบว่า order เป็นของผู้ใช้หรือไม่ (ยกเว้น admin)
    if (order.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: order
    });
  } catch (error) {
    next(error);
  }
};

// อัพเดทคำสั่งซื้อ
export const updateOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { items } = req.body;

    // ดึงข้อมูล order เพื่อตรวจสอบ ownership
    const order = await orderModel.getOrderById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const orderData = { items };
    const result = await orderModel.updateOrder(id, orderData);

    res.json({
      success: true,
      message: 'Order updated successfully',
      data: result
    });
  } catch (error) {
    if (error.message.includes('Only draft')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    if (error.message === 'Order receiving is closed') {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

// ส่งคำสั่งซื้อ
export const submitOrder = async (req, res, next) => {
  try {
    const { id } = req.params;

    // ดึงข้อมูล order เพื่อตรวจสอบ ownership
    const order = await orderModel.getOrderById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const result = await orderModel.submitOrder(id);

    res.json({
      success: true,
      message: 'Order submitted successfully',
      data: result
    });
  } catch (error) {
    if (error.message.includes('Only draft orders')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    if (error.message === 'Order receiving is closed') {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

// ลบคำสั่งซื้อ
export const deleteOrder = async (req, res, next) => {
  try {
    const { id } = req.params;

    // ดึงข้อมูล order เพื่อตรวจสอบ ownership
    const order = await orderModel.getOrderById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    await orderModel.deleteOrder(id);

    res.json({
      success: true,
      message: 'Order deleted successfully'
    });
  } catch (error) {
    if (error.message.includes('Only draft') || error.message.includes('Only draft or submitted')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    if (error.message === 'Order receiving is closed') {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};
