"""Title collision checks do not modify the remote catalogue."""
import unittest
from import_original_library import create_if_no_title, refuse_existing_title


class ImportTitleTests(unittest.TestCase):
    def test_matching_title_stops_with_id_for_each_resource(self):
        for endpoint in ('courses/', 'exams/'):
            with self.subTest(endpoint=endpoint):
                calls = []
                def request(path):
                    calls.append(path)
                    return [{'id': 42, 'title': 'Existing'}, {'id': 43, 'title': 'Other'}]
                with self.assertRaisesRegex(SystemExit, "Existing.*42.*review"):
                    refuse_existing_title(request, endpoint, 'Existing')
                self.assertEqual(calls, [endpoint])

    def test_lost_create_response_stops_retry_for_each_resource(self):
        for endpoint in ('courses/', 'exams/'):
            with self.subTest(endpoint=endpoint):
                rows = []
                def request(path, method='GET', data=None):
                    if method == 'GET':
                        return rows
                    rows.append({'id': 42, 'title': data['title']})
                    raise TimeoutError('response lost')
                with self.assertRaises(TimeoutError):
                    create_if_no_title(request, endpoint, 'Existing', {'title': 'Existing'})
                with self.assertRaisesRegex(SystemExit, 'Existing.*42'):
                    create_if_no_title(request, endpoint, 'Existing', {'title': 'Existing'})
                self.assertEqual(len(rows), 1)

    def test_distinct_title_can_proceed(self):
        refuse_existing_title(lambda path: [{'id': 1, 'title': 'Other'}], 'courses/', 'New')


if __name__ == '__main__':
    unittest.main()
