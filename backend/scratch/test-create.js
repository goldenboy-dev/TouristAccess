const prisma = require('../src/utils/prisma');
const ticketController = require('../src/controllers/ticket.controller');

const req = {
  body: {
    customer_name: 'Test',
    visit_date: '2026-10-10',
    payment_method: 'CASH',
    number_of_adults: 1,
    number_of_children: 0
  },
  user: {
    id: 1
  }
};

const res = {
  status: (code) => {
    console.log('STATUS:', code);
    return {
      json: (data) => console.log('DATA:', data)
    };
  },
  json: (data) => console.log('DATA:', data)
};

ticketController.createTicket(req, res).catch(console.error);
