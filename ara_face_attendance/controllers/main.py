from odoo import http
from odoo.http import request
from odoo.addons.hr_attendance.controllers.main import HrAttendance


class HrAttendances(HrAttendance):
    @http.route("/get_employee_image", type="json", auth="public")
    def get_employee_image(self, employee_id):
        image = request.env["hr.employee"].sudo().browse(
            employee_id).image_1920
        return image
